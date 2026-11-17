'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = {
  id:number; process_type:string; operation_type:string; op_number:string; scheduled_date:string;
  product_description?:string; product_reference?:string; planned_quantity:number;
  reported_quantity:number; entries:Entry[];
};

const PROCESS_ORDER = ['CORTE LASER','RADIADOR','PRENSA','BORDEADEIRA'];
const PROCESS_NAMES:Record<string,string> = {
  'CORTE LASER':'Corte Laser', RADIADOR:'Radiador', PRENSA:'Prensa', BORDEADEIRA:'Bordadeira'
};
const STAGES = ['CORPO','FUNDO','TAMPA'];
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

  const monthRows = rows.filter(r => PROCESS_ORDER.includes(r.process_type) && String(r.scheduled_date).slice(0,7)===month);

  const sectors = PROCESS_ORDER.map(key => {
    const items = monthRows.filter(r=>r.process_type===key);
    const planned = items.reduce((sum,r)=>sum+Number(r.planned_quantity||0),0);
    const done = items.reduce((sum,r)=>sum+Math.min(Number(r.reported_quantity||0),Number(r.planned_quantity||0)),0);
    const late = items.filter(r=>String(r.scheduled_date).slice(0,10)<today() && Number(r.reported_quantity||0)<Number(r.planned_quantity||0));
    const lateOps = new Set(late.map(r=>String(r.scheduled_date).slice(0,10)+'|'+r.op_number)).size;
    return {key,name:PROCESS_NAMES[key],planned,done,pending:Math.max(0,planned-done),lateOps,pct:planned?Math.round(done/planned*100):0};
  });

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

  const laserRows = monthRows.filter(r=>r.process_type==='CORTE LASER');
  const opMap = new Map<string,Schedule[]>();
  laserRows.forEach(r=>{
    const key=String(r.scheduled_date).slice(0,10)+'|'+r.op_number;
    const list=opMap.get(key)||[];
    list.push(r);
    opMap.set(key,list);
  });
  const audit = Array.from(opMap.entries()).map(([key,items])=>{
    const date=key.split('|')[0];
    const stages=STAGES.map(name=>{
      const matching=items.filter(i=>i.operation_type.toUpperCase()===name);
      const planned=matching.reduce((sum,i)=>sum+Number(i.planned_quantity||0),0);
      const done=matching.reduce((sum,i)=>sum+Number(i.reported_quantity||0),0);
      return {name,planned,done};
    });
    const complete=stages.every(s=>s.planned>0 && s.done>=s.planned);
    const started=stages.some(s=>s.done>0);
    const state=complete?'CONCLUÍDA':started?'PARCIAL':date<today()?'ATRASADA':'NÃO INICIADA';
    return {key,date,op:items[0].op_number,product:items[0].product_description||items[0].product_reference||'—',stages,state};
  }).filter(a=>!dayFilter||a.date===dayFilter)
    .filter(a=>!search||a.op.toLowerCase().includes(search.toLowerCase()))
    .filter(a=>status==='TODAS'||a.state===status)
    .sort((a,b)=>b.date.localeCompare(a.date)||a.op.localeCompare(b.op));

  const selectedDate=dayFilter||today();
  const selectedAudit=audit.filter(a=>a.date===selectedDate);
  const stageSummary=STAGES.map(name=>{
    const cells=selectedAudit.flatMap(a=>a.stages.filter(s=>s.name===name));
    const planned=cells.reduce((sum,s)=>sum+s.planned,0);
    const done=cells.reduce((sum,s)=>sum+Math.min(s.done,s.planned),0);
    return {name,planned,done,pending:Math.max(0,planned-done),pct:planned?Math.round(done/planned*100):0};
  });
  const dailyDescending=[...daily].sort((a,b)=>b.date.localeCompare(a.date));

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

      <section className="master-chart master-reference-chart">
        <div className="master-section-kicker">PRODUÇÃO POR DIA E TURNO</div>
        <div className="master-reference-chart-head">
          <h2>Produção por Dia e Turno – Estamparia</h2>
          <div className="master-legend"><span><i className="shift-one" />1º Turno (07:00–17:15)</span><span><i className="shift-two" />2º Turno (17:20–02:48)</span></div>
        </div>
        {daily.length ? (
          <div className="master-reference-bars">
            {daily.map(d=>(
              <div className="master-reference-bar-day" key={d.date}>
                <div className="master-reference-bar-label"><b>{fmt(d.first)}</b><b>{fmt(d.second)}</b></div>
                <div className="master-reference-bar-columns"><i className="shift-one" style={{height:Math.max(2,d.first/maxDaily*100)+'%'}} /><i className="shift-two" style={{height:Math.max(2,d.second/maxDaily*100)+'%'}} /></div>
                <small>{brDate(d.date)}</small>
              </div>
            ))}
          </div>
        ) : <div className="master-empty">Sem apontamentos registrados neste mês.</div>}
      </section>

      <section className="master-reference-bottom">
        <div className="master-daily-summary">
          <div className="master-section-kicker">ACOMPANHAMENTO DIÁRIO</div>
          <div className="master-reference-subhead">
            <h2>Resumo Diário – Estamparia</h2>
            <span>◷　A fábrica opera em 2 turnos:<br/>1º Turno: 07:00–17:15　 2º Turno: 17:20–02:48</span>
          </div>
          <div className="master-reference-table-wrap">
            <table>
              <thead><tr><th>Data</th><th>1º Turno (07:00–17:15)</th><th>2º Turno (17:20–02:48)</th><th>Total do Dia</th></tr></thead>
              <tbody>
                {dailyDescending.map(d=><tr key={d.date}><td>{brDate(d.date)}</td><td>{fmt(d.first)}</td><td>{fmt(d.second)}</td><td className="master-green">{fmt(d.total)}</td></tr>)}
                {!dailyDescending.length && <tr><td colSpan={4}>Sem produção registrada no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="master-laser-conference">
          <div className="master-section-kicker">☀　CONFERÊNCIA DE OPs – CORTE LASER</div>
          <p>Verificação diária da OP por etapa (Corpo, Fundo e Tampa) – Conclusão no dia</p>
          <div className="master-conference-tools">
            <label>Data<input type="date" value={dayFilter} onChange={e=>setDayFilter(e.target.value)} /></label>
            <label>Buscar OP<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número da OP" /></label>
            <label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="TODAS">Todas</option><option>CONCLUÍDA</option><option>PARCIAL</option><option>ATRASADA</option><option>NÃO INICIADA</option></select></label>
            <button onClick={()=>{setDayFilter('');setSearch('');setStatus('TODAS');}}>Limpar</button>
          </div>
          <div className="master-reference-table-wrap master-conference-table-wrap">
            <table>
              <thead><tr><th>OP</th><th>Data</th><th>Produto</th><th>Corpo</th><th>Fundo</th><th>Tampa</th><th>Resultado</th></tr></thead>
              <tbody>
                {audit.map(a=>(
                  <tr key={a.key}>
                    <td className="master-op">{a.op}</td><td>{brDate(a.date)}</td><td>{a.product}</td>
                    {a.stages.map(s=><td key={s.name}><b className={s.planned>0&&s.done>=s.planned?'master-green':'master-orange'}>{fmt(s.done)}/{fmt(s.planned)}</b></td>)}
                    <td><span className={'master-status '+a.state.toLowerCase().replaceAll(' ','-')}>{a.state}</span></td>
                  </tr>
                ))}
                {!audit.length && <tr><td colSpan={7}>Nenhuma OP encontrada para os filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="master-conference-foot">A OP só é considerada concluída quando Corpo, Fundo e Tampa atingem a quantidade programada na mesma data.</div>
        </div>
      </section>

      <section className="master-stage-summary">
        <div className="master-section-kicker">RESUMO POR ETAPA – CORTE LASER · {brDate(selectedDate)}</div>
        <div className="master-stage-summary-grid">
          {stageSummary.map(s=>(
            <article key={s.name}>
              <b>{s.name}</b><span>Programado<strong>{fmt(s.planned)}</strong></span>
              <span>Realizado<strong className="master-green">{fmt(s.done)}</strong></span>
              <span>Pendente<strong className="master-orange">{fmt(s.pending)}</strong></span>
              <span>Aderência<strong>{s.pct}%</strong></span>
            </article>
          ))}
        </div>
      </section>

      {loading && <div className="master-loading">Carregando produção...</div>}
      {error && <div className="master-error" role="alert">{error}</div>}
    </main>
  );
}
