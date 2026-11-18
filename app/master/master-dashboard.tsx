'use client';

import React, { useEffect, useState, type CSSProperties } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = {
  id:number; process_type:string; operation_type:string; op_number:string; scheduled_date:string;
  product_description?:string; product_reference?:string; order_quantity?:number; planned_quantity:number;
  reported_quantity:number; entries:Entry[];
};

const PROCESS_ORDER = ['CORTE LASER','RADIADOR','PRENSA','BORDADEIRA'];
const PROCESS_NAMES:Record<string,string> = {
  'CORTE LASER':'Corte Laser', RADIADOR:'Radiador', PRENSA:'Prensa', BORDADEIRA:'Bordadeira'
};
const STAGES = ['CORPO','FUNDO','TAMPA'];
const normalizeProcess = (value:string) => { const key=String(value||'').toUpperCase(); return key==='BORDEADEIRA'?'BORDADEIRA':key; };
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
  const [dateFrom,setDateFrom] = useState(today().slice(0,7)+'-01');
  const [dateTo,setDateTo] = useState(today().slice(0,7)+'-'+String(new Date(Number(today().slice(0,4)),Number(today().slice(5,7)),0).getDate()).padStart(2,'0'));
  const [dayFilter,setDayFilter] = useState('');
  const [search,setSearch] = useState('');
  const [status,setStatus] = useState('TODAS');
  const [selectedSector,setSelectedSector] = useState('CORTE LASER');
  const [opSearch,setOpSearch] = useState('');
  const [opStatus,setOpStatus] = useState('TODOS');
  const [opSituation,setOpSituation] = useState('TODAS');
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

  const monthRows = rows.filter(r => { const date=String(r.scheduled_date).slice(0,10); return PROCESS_ORDER.includes(normalizeProcess(r.process_type)) && date>=dateFrom && date<=dateTo; });

  // As etapas/subseroes de uma mesma OP representam as mesmas pecas.
  // Somamos dentro de cada etapa, mas contamos a quantidade da OP apenas uma vez.
  const quantitySummary = (items:Schedule[]) => {
    // Cada registro/suboperação pode repetir a mesma quantidade programada
    // para a OP no mesmo dia. A quantidade física do grupo é contada uma vez.
    const planned = Math.max(0,...items.map(row=>Number(row.planned_quantity || 0)));
    // Para o realizado, não somar suboperações: considerar o maior avanço
    // registrado entre os registros que representam a mesma quantidade.
    const done = Math.min(planned,Math.max(0,...items.map(row=>Number(row.reported_quantity || 0))));
    return {planned,done,pending:Math.max(0,planned-done)};
  };
  const sectorOpGroups = (items:Schedule[]) => {
    const groups = new Map<string,Schedule[]>();
    items.forEach(row => {
      // Suboperações da mesma OP no mesmo dia não podem criar grupos separados.
      const key = [String(row.scheduled_date).slice(0,10),String(row.op_number)].join('|');
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key,group);
    });
    return Array.from(groups.entries()).map(([key,group]) => ({key,items:group,...quantitySummary(group)}));
  };

  const sectors = PROCESS_ORDER.map(key => {
    const items = monthRows.filter(r=>normalizeProcess(r.process_type)===key);
    const groups = sectorOpGroups(items);
    const planned = groups.reduce((sum,group)=>sum+group.planned,0);
    const done = groups.reduce((sum,group)=>sum+group.done,0);
    const late = groups.filter(group=>group.key.split('|')[0]<today() && group.pending>0);
    const lateOps = late.length;
    return {key,name:PROCESS_NAMES[key],planned,done,pending:Math.max(0,planned-done),lateOps,pct:planned?Math.round(done/planned*100):0};
  });


  // Uma linha para cada OP/produto/dia programado.
  // A mesma OP aparece novamente quando tiver programação em outro dia.
  const masterOpMap = new Map<string, Schedule[]>();
  monthRows.forEach(row => {
    const dateKey = String(row.scheduled_date).slice(0,10);
    const identity = [String(row.op_number), dateKey].join('|');
    const group = masterOpMap.get(identity) || [];
    group.push(row);
    masterOpMap.set(identity, group);
  });
  const stageOrder = ['CORPO','FUNDO','TAMPA','CORTE','DOBRA','ESTAMPAGEM','PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE','BORDA','NÚMERO DE SÉRIE'];
  const masterOps = Array.from(masterOpMap.entries()).map(([key, items]) => {
    const dateKey = String(items[0].scheduled_date).slice(0,10);
    const bySector = PROCESS_ORDER.map(sector => {
      const sectorRows = items.filter(row => normalizeProcess(row.process_type) === sector);
      const stageNames = Array.from(new Set(sectorRows.map(row => String(row.operation_type || 'PROCESSO').trim().toUpperCase())))
        .sort((a,b) => { const ai=stageOrder.indexOf(a), bi=stageOrder.indexOf(b); return (ai<0?999:ai)-(bi<0?999:bi) || a.localeCompare(b); });
      const stages = stageNames.map(name => {
        const matches = sectorRows.filter(row => String(row.operation_type || 'PROCESSO').trim().toUpperCase() === name);
        const planned = matches.reduce((sum,row) => sum + Number(row.planned_quantity || 0),0);
        const done = matches.reduce((sum,row) => sum + Number(row.reported_quantity || 0),0);
        const pending = Math.max(0,planned-done);
        const state = planned > 0 && done >= planned ? 'OK' : done > 0 ? 'EM ANDAMENTO' : 'PENDENTE';
        return {name, planned, done, pending, state, percent:planned>0?Math.min(100,done/planned*100):0};
      });
      const programmed = stages.filter(stage => stage.planned > 0);
      // As etapas do mesmo setor são operações sucessivas sobre as mesmas peças.
      // O resumo do setor considera a maior quantidade programada e o menor realizado.
      const planned = programmed.length ? Math.max(...programmed.map(stage => stage.planned)) : 0;
      const done = programmed.length ? Math.min(planned, ...programmed.map(stage => stage.done)) : 0;
      const pending = Math.max(0, planned - done);
      const complete = programmed.length > 0 && programmed.every(stage => stage.done >= stage.planned);
      const percent = planned ? Math.round(done / planned * 100) : 0;
      const state = !programmed.length ? 'NÃO PROGRAMADO' : complete ? 'OK' : done > 0 ? 'EM ANDAMENTO' : 'PENDENTE';
      return {sector, stages, planned, done, pending, state, complete, percent, hasSchedule:programmed.length>0};
    });
    const completeCount = bySector.filter(sector => sector.complete).length;
    const percent = Math.round(bySector.reduce((sum,sector) => sum + sector.percent,0) / PROCESS_ORDER.length);
    const complete = bySector.length === PROCESS_ORDER.length && bySector.every(sector => sector.complete);
    const doneAny = bySector.some(sector => sector.stages.some(stage => stage.done > 0));
    const overall = complete ? 'CONCLUÍDA' : doneAny ? completeCount + ' DE ' + PROCESS_ORDER.length + ' SETORES CONCLUÍDOS' : 'AGUARDANDO';
    const quantity = Math.max(0,...bySector.map(sector => sector.planned));
    const late = !complete && dateKey < today();
    return {key, dateKey, dateLabel:dateKey?brDate(dateKey):'—', op:items[0].op_number, product:items[0].product_description || items[0].product_reference || '—', quantity, bySector, percent, overall, complete, completeCount, late};
  }).filter(item => !opSearch || String(item.op).toLowerCase().includes(opSearch.toLowerCase()) || item.product.toLowerCase().includes(opSearch.toLowerCase()))
    .filter(item => opStatus === 'TODOS' || (opStatus === 'CONCLUÍDA' ? item.complete : opStatus === 'EM PRODUÇÃO' ? item.overall !== 'AGUARDANDO' && !item.complete : item.overall === 'AGUARDANDO'))
    .filter(item => opSituation === 'TODAS' || (opSituation === 'ATRASADA' ? item.late : !item.late))
    .filter(item => opSector === 'TODOS' || item.bySector.some(sector => sector.sector === opSector && sector.hasSchedule))
    .sort((a,b) => a.dateKey.localeCompare(b.dateKey) || String(a.op).localeCompare(String(b.op)));

  const masterOpCounts = {
    total:masterOps.length,
    complete:masterOps.filter(item => item.complete).length,
    active:masterOps.filter(item => item.overall !== 'AGUARDANDO' && !item.complete).length,
    waiting:masterOps.filter(item => item.overall === 'AGUARDANDO').length
  };

  // Resumo geral: cada OP/produto/dia representa uma quantidade física única.
  // Os setores e suboperações são etapas da mesma quantidade, não parcelas para somar.
  const overallMap = new Map<string, Schedule[]>();
  monthRows.forEach(row => {
    // Uma OP/dia é uma única quantidade física, mesmo com vários subitens.
    const key = [String(row.scheduled_date).slice(0,10),String(row.op_number)].join('|');
    const group = overallMap.get(key) || [];
    group.push(row);
    overallMap.set(key,group);
  });
  const overallGroups = Array.from(overallMap.entries()).map(([key,items]) => {
    const bySector = PROCESS_ORDER.map(sector => quantitySummary(items.filter(row=>normalizeProcess(row.process_type)===sector)));
    const planned = Math.max(0,...bySector.map(value=>value.planned));
    const done = Math.min(planned,Math.max(0,...bySector.map(value=>value.done)));
    return {key,planned,done,pending:Math.max(0,planned-done)};
  });
  const plannedTotal = overallGroups.reduce((sum,group)=>sum+group.planned,0);
  const doneTotal = overallGroups.reduce((sum,group)=>sum+group.done,0);
  const pendingTotal = Math.max(0,plannedTotal-doneTotal);
  const lateGroups = overallGroups.filter(group=>group.key.split('|')[0]<today() && group.pending>0);
  const latePieces = lateGroups.reduce((sum,group)=>sum+group.pending,0);
  const lateOps = lateGroups.length;
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
    const totals = quantitySummary(items);
    const planned = totals.planned;
    const done = totals.done;
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
      const validStages = stageCompletions.filter(item=>item.planned>0);
      planned = validStages.length ? Math.max(...validStages.map(item=>item.planned)) : 0;
      done = validStages.length ? Math.min(planned,...validStages.map(item=>Math.min(item.done,item.planned))) : 0;
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

      <section className="master-op-progress-panel master-sketch-panel">
      <header className="master-sketch-header">
        <div className="master-sketch-brand">
          <div className="master-sketch-mark">◇</div>
          <div>
            <h1>Acompanhamento Geral das Ordens – Avanço das OPs</h1>
            <p>Acompanhe o avanço de cada Ordem de Produção (OP) em todos os setores da Estamparia.</p>
          </div>
        </div>
        <div className="master-sketch-filters">
          <input aria-label="Buscar OP, produto ou descrição" value={opSearch} onChange={e=>setOpSearch(e.target.value)} placeholder="⌕  Buscar OP, produto ou descrição..." />
          <label>Data (De)<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></label>
          <label>Data (Até)<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} /></label>
          <label>Status da OP<select value={opStatus} onChange={e=>setOpStatus(e.target.value)}>
            <option value="TODOS">Todas</option><option value="CONCLUÍDA">Concluída</option><option value="EM PRODUÇÃO">Em produção</option><option value="AGUARDANDO">Aguardando</option>
          </select></label>
          <label>Situação<select value={opSituation} onChange={e=>setOpSituation(e.target.value)}>
            <option value="TODAS">Todas</option><option value="ATRASADA">Atrasada</option><option value="NO PRAZO">No prazo</option>
          </select></label>
          <button type="button" onClick={load} disabled={loading} title="Atualizar">↻</button>
        </div>
      </header>
      <section className="master-sketch-summary">
        <strong>Resumo das programações:</strong>
        <span className="summary-total"><b>{fmt(masterOpCounts.total)}</b> Linhas por dia</span>
        <span className="summary-done"><b>✓ {fmt(masterOpCounts.complete)}</b> Concluídas</span>
        <span className="summary-active"><b>◉ {fmt(masterOpCounts.active)}</b> Em produção</span>
        <span className="summary-waiting"><b>⌛ {fmt(masterOpCounts.waiting)}</b> Aguardando</span>
      </section>
      <section className="master-sketch-table-wrap">
        <table className="master-sketch-table">
          <thead>
            <tr>
              <th rowSpan={2} className="sketch-op">OP</th>
              <th rowSpan={2} className="sketch-product">Produto / Descrição</th>
              <th rowSpan={2} className="sketch-date">Data</th>
              <th rowSpan={2} className="sketch-qty">Qtd.<br/>OP</th>
              {PROCESS_ORDER.map(key=><th key={key} colSpan={4} className={'sketch-sector sketch-'+key.toLowerCase().replaceAll(' ','-')}>{key==='BORDADEIRA'?'♧  BORDADEIRA':key==='CORTE LASER'?'⚒  CORTE LASER':key==='RADIADOR'?'▥  RADIADOR':'▣  PRENSA'}</th>)}
              <th rowSpan={2} className="sketch-progress">Avanço<br/>Geral</th>
              <th rowSpan={2} className="sketch-status">Status da OP</th>
            </tr>
            <tr>
              {PROCESS_ORDER.flatMap(key=>[
                <th key={key+'-planned'} className="sketch-subhead">Prog.</th>,
                <th key={key+'-done'} className="sketch-subhead">Real.</th>,
                <th key={key+'-pending'} className="sketch-subhead">Saldo</th>,
                <th key={key+'-status'} className="sketch-subhead">Status</th>
              ])}
            </tr>
          </thead>
          <tbody>
            {masterOps.map(item=><tr key={item.key}>
              <td className="sketch-op-value">{item.op}</td>
              <td className="sketch-product-value" title={item.product}>{item.product}</td>
              <td className="sketch-date-value">{item.dateLabel}</td>
              <td className="sketch-qty-value">{fmt(item.quantity)}</td>
              {item.bySector.map(sector=><React.Fragment key={sector.sector}>
                <td className="sketch-number">{sector.hasSchedule?fmt(sector.planned):'—'}</td>
                <td className="sketch-number sketch-real">{sector.hasSchedule?fmt(sector.done):'—'}</td>
                <td className="sketch-number sketch-balance">{sector.hasSchedule?fmt(sector.pending):'—'}</td>
                <td className="sketch-state">{sector.hasSchedule
                  ? <span className={'sketch-pill '+(sector.state==='OK'?'pill-ok':sector.state==='EM ANDAMENTO'?'pill-active':'pill-pending')}>{sector.state==='OK'?'✓ OK':sector.state==='EM ANDAMENTO'?'◉ EM ANDAMENTO':'◯ PENDENTE'}</span>
                  : <span className="sketch-no-schedule">—</span>}</td>
              </React.Fragment>)}
              <td className="sketch-progress-value"><div className="sketch-progress-track"><i style={{width:item.percent+'%'}} /></div><b>{item.percent}%</b></td>
              <td className="sketch-overall"><span className={'sketch-pill '+(item.complete?'pill-ok':item.overall==='AGUARDANDO'?'pill-waiting':'pill-active')}>{item.complete?'✓ Concluída':item.overall==='AGUARDANDO'?'⌛ Aguardando':'◉ Em produção'}</span></td>
            </tr>)}
            {!masterOps.length && <tr><td colSpan={22} className="master-op-empty">{loading?'Carregando OPs...':'Nenhuma OP encontrada para os filtros selecionados.'}</td></tr>}
          </tbody>
        </table>
      </section>
      <footer className="master-sketch-legend">
        <b>Legenda de Status:</b>
        <span><i className="master-sketch-pill pill-ok">✓ OK</i> – Etapa concluída</span>
        <span><i className="master-sketch-pill pill-active">◉ EM ANDAMENTO</i> – Produção em execução</span>
        <span><i className="master-sketch-pill pill-pending">◯ PENDENTE</i> – Etapa não iniciada</span>
        <span><i className="master-sketch-pill pill-waiting">⌛ AGUARDANDO</i> – Aguardando início / liberação</span>
      </footer>
      </section>
      {loading && <div className="master-loading">Carregando produção...</div>}
      {error && <div className="master-error" role="alert">{error}</div>}
    </main>
  );
}
