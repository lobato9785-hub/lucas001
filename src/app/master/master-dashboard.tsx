'use client';

import React, { useEffect, useState, type CSSProperties } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = {
  id:number; process_type:string; operation_type:string; op_number:string; scheduled_date:string;
  product_description?:string; product_reference?:string; order_quantity?:number; planned_quantity:number;
  reported_quantity:number; entries:Entry[];
};

const PROCESS_ORDER = ['CORTE LASER','RADIADOR','PRENSA','DOBRADEIRA'];
const PROCESS_NAMES:Record<string,string> = {
  'CORTE LASER':'Corte Laser', RADIADOR:'Radiador', PRENSA:'Prensa', DOBRADEIRA:'Dobradeira'
};
const STAGES = ['CORPO','FUNDO','TAMPA'];
const normalizeProcess = (value:string) => { const key=String(value||'').toUpperCase(); return key==='BORDEADEIRA'?'DOBRADEIRA':key; };
const fmt = (n:number) => new Intl.NumberFormat('pt-BR').format(n || 0);
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const brDate = (s:string) => { const p=s.split('-'); return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0] : s; };
const previousDay = (s:string) => { const d=new Date(s+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10); };

function shiftInfo(value:string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get = (key:string) => parts.find(p=>p.type===key)?.value || '00';
  const day = get('year')+'-'+get('month')+'-'+get('day');
  const mins = Number(get('hour'))*60+Number(get('minute'));
  if (mins>=420 && mins<=1035) return {day,shift:'first' as const};
  if (mins>=1040 || mins<=168) return {day:mins<=168?previousDay(day):day,shift:'second' as const};
  return null;
}

export default function MasterDashboard() {
  const [rows,setRows] = useState<Schedule[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [month,setMonth] = useState(today().slice(0,7));
  const [dayFilter,setDayFilter] = useState('');
  const [search,setSearch] = useState('');
  const [status,setStatus] = useState('TODAS');
  const [selectedSector,setSelectedSector] = useState('CORTE LASER');
  const [opSearch,setOpSearch] = useState('');
  const [opStatus,setOpStatus] = useState('TODOS');
  const [opSector,setOpSector] = useState('TODOS');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/master/production',{cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar os dados.');
      setRows(data.rows || []);
    } catch (e:any) {
      setError(e.message || 'Falha ao carregar os dados.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ load(); },[]);

  const monthRows = rows.filter(r => PROCESS_ORDER.includes(normalizeProcess(r.process_type)) && String(r.scheduled_date).slice(0,7)===month);

  const sectors = PROCESS_ORDER.map(key => {
    const items = monthRows.filter(r=>normalizeProcess(r.process_type)===key);
    const planned = items.reduce((sum,r)=>sum+Number(r.planned_quantity||0),0);
    const done = items.reduce((sum,r)=>sum+Math.min(Number(r.reported_quantity||0),Number(r.planned_quantity||0)),0);
    const late = items.filter(r=>String(r.scheduled_date).slice(0,10)<today() && Number(r.reported_quantity||0)<Number(r.planned_quantity||0));
    const lateOps = new Set(late.map(r=>String(r.scheduled_date).slice(0,10)+'|'+r.op_number)).size;
    return {key,name:PROCESS_NAMES[key],planned,done,pending:Math.max(0,planned-done),lateOps,pct:planned?Math.round(done/planned*100):0};
  });


  // Consolida as programações de cada OP entre os quatro setores.
  // No Corte Laser, Corpo, Fundo e Tampa são somados antes de definir o status.
  const masterOpMap = new Map<string, Schedule[]>();
  monthRows.forEach(row => {
    const identity = [String(row.op_number), String(row.product_reference || row.product_description || '')].join('|');
    const group = masterOpMap.get(identity) || [];
    group.push(row);
    masterOpMap.set(identity, group);
  });
  const masterOps = Array.from(masterOpMap.entries()).map(([key, items]) => {
    const bySector = PROCESS_ORDER.map(sector => {
      const sectorRows = items.filter(row => normalizeProcess(row.process_type) === sector);
      const planned = sectorRows.reduce((sum,row) => sum + Number(row.planned_quantity || 0),0);
      const done = sectorRows.reduce((sum,row) => sum + Number(row.reported_quantity || 0),0);
      const boundedDone = Math.min(done, planned);
      const state = planned > 0 && done >= planned ? 'OK' : done > 0 ? 'EM ANDAMENTO' : 'PENDENTE';
      return { sector, planned, done:boundedDone, state };
    });
    const planned = bySector.reduce((sum,item) => sum + item.planned,0);
    const done = bySector.reduce((sum,item) => sum + item.done,0);
    const percent = planned > 0 ? Math.round(done / planned * 100) : 0;
    const complete = bySector.every(item => item.planned > 0 && item.done >= item.planned);
    const overall = complete ? 'CONCLUÍDA' : done > 0 ? 'EM PRODUÇÃO' : 'AGUARDANDO';
    const dates = items.map(item => String(item.scheduled_date).slice(0,10)).sort();
    return {
      key,
      op:items[0].op_number,
      product:items[0].product_description || items[0].product_reference || '—',
      quantity:Math.max(...items.map(item => Number(item.order_quantity || item.planned_quantity || 0))),
      dateStart:dates[0] || '',
      dateEnd:dates[dates.length - 1] || '',
      bySector,
      planned,
      done,
      percent,
      overall
    };
  }).filter(item => !opSearch || String(item.op).toLowerCase().includes(opSearch.toLowerCase()) || item.product.toLowerCase().includes(opSearch.toLowerCase()))
    .filter(item => opStatus === 'TODOS' || item.overall === opStatus)
    .filter(item => opSector === 'TODOS' || item.bySector.some(sector => sector.sector === opSector && sector.state !== 'PENDENTE'))
    .sort((a,b) => a.dateStart.localeCompare(b.dateStart) || String(a.op).localeCompare(String(b.op)));
  const masterOpCounts = {
    total:masterOps.length,
    complete:masterOps.filter(item => item.overall === 'CONCLUÍDA').length,
    active:masterOps.filter(item => item.overall === 'EM PRODUÇÃO').length,
    waiting:masterOps.filter(item => item.overall === 'AGUARDANDO').length
  };

  const plannedTotal = sectors.reduce((sum,s)=>sum+s.planned,0);
  const doneTotal = sectors.reduce((sum,s)=>sum+s.done,0);
  const pendingTotal = Math.max(0,plannedTotal-doneTotal);
  const lateRows = monthRows.filter(r=>String(r.scheduled_date).slice(0,10)<today() && Number(r.reported_quantity||0)<Number(r.planned_quantity||0));
  const latePieces = lateRows.reduce((sum,r)=>sum+Math.max(0,Number(r.planned_quantity||0)-Number(r.reported_quantity||0)),0);
  const lateOps = new Set(lateRows.map(r=>r.process_type+'|'+String(r.scheduled_date).slice(0,10)+'|'+r.op_number)).size;
  const percent = plannedTotal ? Math.round(doneTotal/plannedTotal*100) : 0;

  const dailyMap = new Map<string,{first:number;second:number}>();
  monthRows.forEach(row=>(row.entries||[]).forEach(entry=>{
    if (!entry.at) return;
    const info=shiftInfo(entry.at);
    if (!info || info.day.slice(0,7)!==month) return;
    const item=dailyMap.get(info.day)||{first:0,second:0};
    item[info.shift]+=Number(entry.quantity||0);
    dailyMap.set(info.day,item);
  }));
  const daily = Array.from(dailyMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>({date,...v,total:v.first+v.second}));
  const maxDaily = Math.max(1,...daily.map(d=>d.total));
  const monthName = new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  const sectorRows = monthRows.filter(r => normalizeProcess(r.process_type) === selectedSector);
  const opMap = new Map<string, Schedule[]>();
  sectorRows.forEach(r => {
    const key = String(r.scheduled_date).slice(0,10) + '|' + r.op_number;
    const group = opMap.get(key) || [];
    group.push(r);
    opMap.set(key, group);
  });
  const audit = Array.from(opMap.entries()).map(([key, items]) => {
    const date = key.split('|')[0];
    const laser = selectedSector === 'CORTE LASER';
    const names = laser ? STAGES : ['PROCESSO'];
    const stages = names.map(name => {
      const matching = laser ? items.filter(i => i.operation_type.toUpperCase() === name) : items;
      return {
        name,
        planned: matching.reduce((sum,i) => sum + Number(i.planned_quantity || 0), 0),
        done: matching.reduce((sum,i) => sum + Number(i.reported_quantity || 0), 0)
      };
    });
    const planned = stages.reduce((sum,s) => sum + s.planned, 0);
    const done = stages.reduce((sum,s) => sum + Math.min(s.done,s.planned), 0);
    const state = planned > 0 && done >= planned ? 'CONCLUÍDA' : done > 0 ? 'PARCIAL' : date < today() ? 'ATRASADA' : 'NÃO INICIADA';
    return {key,date,op:items[0].op_number,product:items[0].product_description || items[0].product_reference || '—',stages,planned,done,pending:Math.max(0,planned-done),state};
  })
    .filter(x => !dayFilter || x.date === dayFilter)
    .filter(x => !search || x.op.toLowerCase().includes(search.toLowerCase()))
    .filter(x => status === 'TODAS' || x.state === status)
    .sort((x,y) => x.date.localeCompare(y.date) || x.op.localeCompare(y.op));
  const selectedDate=dayFilter||today();
  const selectedAudit=audit.filter(a=>a.date===selectedDate);
  const summaryNames = selectedSector === 'CORTE LASER' ? STAGES : ['PROCESSO'];
  const stageSummary=summaryNames.map(name=>{
    const cells=selectedAudit.flatMap(a=>a.stages.filter(s=>s.name===name));
    const planned=cells.reduce((sum,s)=>sum+s.planned,0);
    const done=cells.reduce((sum,s)=>sum+Math.min(s.done,s.planned),0);
    return {name,planned,done,pending:Math.max(0,planned-done),pct:planned?Math.round(done/planned*100):0};
  });
  const dailyDescending=[...daily].sort((a,b)=>b.date.localeCompare(a.date));

  // A data de finalização é o dia do apontamento que completou a OP,
  // e não apenas a data originalmente programada.
  const completionDay = (items:Schedule[], required:number) => {
    const events = items.flatMap(item => (item.entries || []).filter(entry => entry.at).map(entry => ({
      at:String(entry.at), quantity:Number(entry.quantity || 0)
    }))).sort((a,b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let accumulated = 0;
    for (const event of events) {
      accumulated += event.quantity;
      if (accumulated >= required) {
        const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(event.at));
        const get = (name:string) => parts.find(part => part.type === name)?.value || '';
        return get('year')+'-'+get('month')+'-'+get('day');
      }
    }
    return '';
  };
  const completedMap = new Map<string, Schedule[]>();
  monthRows.forEach(row => {
    const key = normalizeProcess(row.process_type) + '|' + row.op_number;
    const group = completedMap.get(key) || [];
    group.push(row);
    completedMap.set(key, group);
  });
  const completedOps = Array.from(completedMap.entries()).flatMap(([key,items]) => {
    const [sector,op] = key.split('|');
    if (search && !op.toLowerCase().includes(search.toLowerCase())) return [];
    let planned = 0;
    let done = 0;
    let finishedAt = '';
    if (sector === 'CORTE LASER') {
      const stageCompletions = STAGES.map(name => {
        const matches = items.filter(item => item.operation_type.toUpperCase() === name);
        const stagePlanned = matches.reduce((sum,item) => sum + Number(item.planned_quantity || 0),0);
        const stageDone = matches.reduce((sum,item) => sum + Number(item.reported_quantity || 0),0);
        return {planned:stagePlanned,done:stageDone,finished:stagePlanned>0 && stageDone>=stagePlanned ? completionDay(matches,stagePlanned) : ''};
      });
      planned = stageCompletions.reduce((sum,item) => sum + item.planned,0);
      done = stageCompletions.reduce((sum,item) => sum + Math.min(item.done,item.planned),0);
      if (!stageCompletions.every(item => item.planned>0 && item.done>=item.planned && item.finished)) return [];
      const finishedDays = stageCompletions.map(item=>item.finished).sort();
      finishedAt = finishedDays[finishedDays.length-1] || '';
    } else {
      planned = items.reduce((sum,item) => sum + Number(item.planned_quantity || 0),0);
      done = items.reduce((sum,item) => sum + Math.min(Number(item.reported_quantity || 0),Number(item.planned_quantity || 0)),0);
      if (planned<=0 || done<planned) return [];
      finishedAt = completionDay(items,planned);
    }
    if (!finishedAt || (dayFilter && finishedAt !== dayFilter)) return [];
    return [{
      key,sector,date:finishedAt,op,
      product:items[0].product_description || items[0].product_reference || '—',
      planned,done
    }];
  }).sort((a,b) => b.date.localeCompare(a.date) || PROCESS_ORDER.indexOf(a.sector)-PROCESS_ORDER.indexOf(b.sector) || a.op.localeCompare(b.op));
  const completedBySector = PROCESS_ORDER.map(sector => ({
    sector,
    name:PROCESS_NAMES[sector],
    count:completedOps.filter(item => item.sector === sector).length
  }));

  return (
    <main className="master-page master-reference">
      <header className="master-heading">
        <div>
          <div className="master-breadcrumb">ITAM　›　MASTER - ESTAMPARIA</div>
          <h1>▣　Estamparia</h1>
          <p>Acompanhamento da Produção – Visão Master</p>
        </div>
        <div className="master-head-actions">
          <label className="master-period">Período <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setDayFilter('');}} /></label>
          <button onClick={load} disabled={loading}>↻ Atualizar</button>
          <span className="master-live">● Dados do banco</span>
          <a href="/">Sair</a>
        </div>
      </header>

      <section className="master-overview">
        <div className="master-overview-main">
          <div className="master-overview-title">✓　Resumo Geral do Mês <span>{monthName}</span></div>
          <div className="master-overview-grid">
            <div><small>PROGRAMADA</small><b>{fmt(plannedTotal)}</b></div>
            <div><small>REALIZADA</small><b className="master-green">{fmt(doneTotal)}</b></div>
            <div><small>PENDENTE</small><b className="master-orange">{fmt(pendingTotal)}</b></div>
            <div className="master-overview-progress">
              <div className="master-ring" style={{'--progress':percent+'%'} as CSSProperties}><b>{percent}%</b></div>
              <div><small>Conclusão do Mês</small><div className="master-track"><i style={{width:percent+'%'}} /></div></div>
            </div>
          </div>
        </div>
        <aside className="master-overview-late">
          <b>⚑　Peças Atrasadas</b>
          <strong>{fmt(latePieces)}</strong>
          <span>{fmt(lateOps)} programações vencidas</span>
        </aside>
      </section>

      <section className="master-process-grid">
        {sectors.map((s,i)=>(
          <article className={'master-process-card process-'+i} key={s.key}>
            <div className="master-process-title"><b>{s.name.toUpperCase()}</b><span>● PROGRESSO</span></div>
            <div className="master-process-metrics">
              <div><small>Programado</small><b>{fmt(s.planned)}</b></div>
              <div><small>Realizado</small><b className="master-green">{fmt(s.done)}</b></div>
              <div><small>Pendente</small><b className="master-orange">{fmt(s.pending)}</b></div>
              <div><small>Em Atraso</small><b className="master-red">{fmt(s.lateOps)}</b></div>
            </div>
            <div className="master-process-track"><i style={{width:s.pct+'%'}} /></div>
            <footer><span>{s.pct}% concluído</span><span>{fmt(s.planned)} peças</span></footer>
          </article>
        ))}
      </section>

      <div className="master-op-progress-panel">
        <div className="master-op-progress-heading">
          <div>
            <div className="master-section-kicker">ACOMPANHAMENTO GERAL DAS ORDENS</div>
            <h2>Avanço das OPs por Setor</h2>
            <p>Visualize a mesma Ordem de Produção passando pelo Corte Laser, Radiador, Prensa e Bordadeira.</p>
          </div>
          <div className="master-op-progress-filters">
            <input aria-label="Buscar OP ou produto" value={opSearch} onChange={e=>setOpSearch(e.target.value)} placeholder="Buscar OP ou produto..." />
            <select aria-label="Filtrar status" value={opStatus} onChange={e=>setOpStatus(e.target.value)}>
              <option value="TODOS">Status: Todos</option><option value="CONCLUÍDA">Concluídas</option><option value="EM PRODUÇÃO">Em produção</option><option value="AGUARDANDO">Aguardando</option>
            </select>
            <select aria-label="Filtrar setor" value={opSector} onChange={e=>setOpSector(e.target.value)}>
              <option value="TODOS">Setor: Todos</option>{PROCESS_ORDER.map(key=><option key={key} value={key}>{PROCESS_NAMES[key]}</option>)}
            </select>
            <button type="button" onClick={()=>{setOpSearch('');setOpStatus('TODOS');setOpSector('TODOS');}}>Limpar</button>
          </div>
        </div>
        <div className="master-op-progress-summary">
          <span><b>{fmt(masterOpCounts.total)}</b> OPs no período</span>
          <span className="is-done"><b>{fmt(masterOpCounts.complete)}</b> Concluídas</span>
          <span className="is-active"><b>{fmt(masterOpCounts.active)}</b> Em produção</span>
          <span className="is-waiting"><b>{fmt(masterOpCounts.waiting)}</b> Aguardando</span>
        </div>
        <div className="master-op-progress-table-wrap">
          <table>
            <thead>
              <tr><th rowSpan={3}>OP</th><th rowSpan={3}>Produto</th><th rowSpan={3}>Qtd. OP</th><th rowSpan={3}>Programação</th><th colSpan={16} className="master-op-process-group">Programação e avanço fixo por setor</th><th rowSpan={3}>Avanço da OP</th><th rowSpan={3}>Status geral</th></tr>
              <tr>{PROCESS_ORDER.map(key=><th key={key} colSpan={4}>{PROCESS_NAMES[key]}</th>)}</tr>
              <tr>{PROCESS_ORDER.flatMap(key=>[<th key={key+'p'}>Prog.</th>,<th key={key+'r'}>Real.</th>,<th key={key+'s'}>Saldo</th>,<th key={key+'st'}>Status</th>])}</tr>
            </thead>
            <tbody>
              {masterOps.map(item=><tr key={item.key}>
                <td className="master-op">{item.op}</td><td className="master-op-product">{item.product}</td><td>{fmt(item.quantity)}</td>
                <td>{item.dateStart === item.dateEnd ? brDate(item.dateStart) : brDate(item.dateStart)+' a '+brDate(item.dateEnd)}</td>
                {item.bySector.map(sector=><React.Fragment key={sector.sector}><td>{fmt(sector.planned)}</td><td className="master-op-realized">{fmt(sector.done)}</td><td className="master-op-pending">{fmt(Math.max(0,sector.planned-sector.done))}</td><td><span className={'master-op-sector-status '+sector.state.toLowerCase().replaceAll(' ','-')}><b>{sector.state === 'OK' ? '✓' : sector.state === 'EM ANDAMENTO' ? '◷' : '•'}</b>{sector.state}</span></td></React.Fragment>)}
                <td><div className="master-op-progress-cell"><div className="master-op-progress-track"><i style={{width:item.percent+'%'}} /></div><b>{item.percent}%</b></div></td>
                <td><span className={'master-op-overall '+(item.overall === 'CONCLUÍDA' ? 'is-done' : item.overall === 'EM PRODUÇÃO' ? 'is-active' : 'is-waiting')}>{item.overall}</span></td>
              </tr>)}
              {!masterOps.length && <tr><td colSpan={22} className="master-op-empty">{loading ? 'Carregando OPs...' : 'Nenhuma OP encontrada para os filtros deste período.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="master-op-progress-legend"><b>Legenda:</b><span className="is-done">✓ OK – setor concluído</span><span className="is-active">◷ Em andamento – produção iniciada</span><span className="is-waiting">• Pendente – aguardando início</span></div>
        <div className="master-conference-foot">A OP só fica CONCLUÍDA quando Corte Laser, Radiador, Prensa e Bordadeira atingirem suas quantidades programadas. Acompanhe a programação, o realizado, o saldo e o status de cada setor na mesma linha da OP.</div>
      </div>


      {loading && <div className="master-loading">Carregando produção...</div>}
      {error && <div className="master-error" role="alert">{error}</div>}
    </main>
  );
}
