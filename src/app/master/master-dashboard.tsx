'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = {
  id:number; process_type:string; operation_type:string; op_number:string; parent_op?:string;
  scheduled_date:string; client_name?:string; product_reference?:string; product_description?:string;
  production_line?:string; power_pa?:string; order_quantity:number; planned_quantity:number;
  reported_quantity:number; series_start?:string; series_end?:string; entries:Entry[];
};

const fmt=(n:number)=>new Intl.NumberFormat('pt-BR').format(n||0);
const label=(s:string)=>s==='PLASMA'||s==='DOBRADEIRA'?'FERRAGEM':s;
const sectorOrder=['CORTE LASER','RADIADOR','BORDEADEIRA','PRENSA','PLASMA','DOBRADEIRA'];
const todayManaus=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const localParts=(value:string)=>{
  const d=new Date(value);
  if(Number.isNaN(+d)) return null;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  const get=(k:string)=>parts.find(p=>p.type===k)?.value||'00';
  return {date:get('year')+'-'+get('month')+'-'+get('day'),hour:Number(get('hour')),minute:Number(get('minute'))};
};
const shiftDay=(date:string)=>{
  const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10);
};
const dateBR=(s:string)=>{const p=s.split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s};

export default function MasterDashboard(){
  const [rows,setRows]=useState<Schedule[]>([]);
  const selectedSector = 'CORTE LASER';
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [month,setMonth]=useState(todayManaus().slice(0,7));
  const [dayFilter,setDayFilter]=useState('');
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('TODAS');

  async function load(){
    setLoading(true);setError('');
    try{
      const r=await fetch('/api/master/production',{cache:'no-store'});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Não foi possível carregar o painel.');
      setRows(j.rows||[]);
    }catch(e:any){setError(e.message||'Falha ao carregar os dados.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);

  const monthRows=useMemo(()=>rows.filter(r=>r.process_type===selectedSector&&String(r.scheduled_date).slice(0,7)===month),[rows,month]);
  const totals=useMemo(()=>{
    const planned=monthRows.reduce((n,r)=>n+Number(r.planned_quantity||0),0);
    const done=monthRows.reduce((n,r)=>n+Math.min(Number(r.reported_quantity||0),Number(r.planned_quantity||0)),0);
    const pending=Math.max(0,planned-done);
    const lateRows=monthRows.filter(r=>String(r.scheduled_date).slice(0,10)<todayManaus()&&Number(r.reported_quantity||0)<Number(r.planned_quantity||0));
    const late= new Set(lateRows.map(r=>String(r.scheduled_date).slice(0,10)+'|'+r.op_number)).size;
    const latePieces=lateRows.reduce((n,r)=>n+Math.max(0,Number(r.planned_quantity||0)-Number(r.reported_quantity||0)),0);
    return {planned,done,pending,late,latePieces,pct:planned?Math.round(done/planned*100):0};
  },[monthRows]);

  const sectors=useMemo(()=>sectorOrder.map(key=>{
    const data=monthRows.filter(r=>r.process_type===key);
    const planned=data.reduce((n,r)=>n+Number(r.planned_quantity||0),0);
    const done=data.reduce((n,r)=>n+Math.min(Number(r.reported_quantity||0),Number(r.planned_quantity||0)),0);
    const pending=Math.max(0,planned-done);
    const lateRows=data.filter(r=>String(r.scheduled_date).slice(0,10)<todayManaus()&&Number(r.reported_quantity||0)<Number(r.planned_quantity||0));
    const late=new Set(lateRows.map(r=>String(r.scheduled_date).slice(0,10)+'|'+r.op_number)).size;
    return {key,name:label(key),planned,done,pending,late,pct:planned?Math.round(done/planned*100):0};
  }).filter(s=>s.planned||s.done),[monthRows]);

  const daily=useMemo(()=>{
    const map=new Map<string,{first:number;second:number}>();
    for(const row of monthRows) for(const entry of row.entries||[]){
      if(!entry.at) continue;
      const p=localParts(entry.at); if(!p) continue;
      const minutes=p.hour*60+p.minute;
      let day=p.date,shift: 'first'|'second'|null=null;
      if(minutes>=420&&minutes<=1035) shift='first';
      else if(minutes>=1040||minutes<=168) {shift='second';if(minutes<=168) day=shiftDay(day);}
      if(!shift||day.slice(0,7)!==month) continue;
      const v=map.get(day)||{first:0,second:0};
      v[shift]+=Number(entry.quantity||0);map.set(day,v);
    }
    return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>({date,...v,total:v.first+v.second}));
  },[monthRows,month]);

  const audit=useMemo(()=>{
    const map=new Map<string,Schedule[]>();
    for(const r of monthRows){
      const key=[String(r.scheduled_date).slice(0,10),String(r.op_number),r.series_start||'',r.series_end||''].join('|');
      const list=map.get(key)||[];list.push(r);map.set(key,list);
    }
    return [...map.entries()].map(([key,items])=>{
      const planned=items.reduce((n,r)=>n+Number(r.planned_quantity||0),0);
      const done=items.reduce((n,r)=>n+Math.min(Number(r.reported_quantity||0),Number(r.planned_quantity||0)),0);
      const complete=items.length>0&&items.every(r=>Number(r.planned_quantity||0)>0&&Number(r.reported_quantity||0)>=Number(r.planned_quantity||0));
      const date=String(items[0].scheduled_date).slice(0,10);
      const started=items.some(r=>Number(r.reported_quantity||0)>0);
      const state=complete?'CONCLUÍDA':started?'PARCIAL':date<todayManaus()?'ATRASADA':'NÃO INICIADA';
      return {key,date,op:items[0].op_number,items,planned,done,pending:Math.max(0,planned-done),complete,state};
    }).filter(x=>!dayFilter||x.date===dayFilter).filter(x=>!search||[x.op,...x.items.map(i=>i.parent_op||'')].join(' ').toLowerCase().includes(search.toLowerCase())).filter(x=>status==='TODAS'||x.state===status).sort((a,b)=>b.date.localeCompare(a.date)||a.op.localeCompare(b.op));
  },[monthRows,dayFilter,search,status]);

  const maxDaily=Math.max(1,...daily.map(d=>d.total));
  const monthTitle=new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  function changeMonth(delta:number){const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+delta);setMonth(d.toISOString().slice(0,7));setDayFilter('');}

  return <div className="master-shell">
    <aside className="master-sidebar">
      <div className="master-side-brand"><span>ITAM</span><b>MASTER</b><small>ESTAMPARIA</small></div>
      <div className="master-side-caption">PROCESSOS</div>
      <nav className="master-side-nav" aria-label="Processos da estamparia">
        <button className="active" type="button" aria-current="page"><span>▥</span><b>CORTE LASER</b><i/></button>
        <button type="button" disabled><span>◈</span><b>RADIADOR</b><small>EM BREVE</small></button>
        <button type="button" disabled><span>▤</span><b>BORDADEIRA</b><small>EM BREVE</small></button>
        <button type="button" disabled><span>▦</span><b>PRENSA</b><small>EM BREVE</small></button>
      </nav>
      <div className="master-side-foot"><i/> Dados conectados</div>
    </aside>
    <main className="master-page">
    <header className="master-heading">
      <div><div className="master-breadcrumb">ITAM　›　MASTER - CORTE LASER</div><h1>▥　Corte Laser</h1><p>Programação, apontamentos e conferência das OPs do Corte Laser.</p></div>
      <div className="master-head-actions"><span className="master-live">● Dados do banco</span><button onClick={load} disabled={loading}>↻ Atualizar</button><a href="/">Sair</a></div>
    </header>

    <section className="master-summary">
      <div className="master-summary-title"><b>✓　Resumo do Corte Laser no Mês</b><span>{monthTitle}</span></div>
      <div className="master-summary-grid">
        <div><small>PROGRAMADA</small><strong>{fmt(totals.planned)}</strong></div>
        <div><small>REALIZADA</small><strong className="master-green">{fmt(totals.done)}</strong></div>
        <div><small>PENDENTE</small><strong className="master-orange">{fmt(totals.pending)}</strong></div>
        <div className="master-progress-wrap"><div className="master-ring" style={{'--progress':totals.pct+'%'} as CSSProperties}><b>{totals.pct}%</b></div><div><small>Conclusão do mês</small><div className="master-track"><i style={{width:totals.pct+'%'}}/></div></div></div>
      </div>
    </section>

    <section className="master-sector-grid">
      {sectors.map(s=><article className="master-sector-card" key={s.key}><div className="master-sector-title"><b>{s.name}</b><span>● Produção</span></div><div className="master-sector-metrics"><div><small>Programada</small><b>{fmt(s.planned)}</b></div><div><small>Realizada</small><b className="master-green">{fmt(s.done)}</b></div><div><small>Pendente</small><b className="master-orange">{fmt(s.pending)}</b></div><div><small>Em atraso</small><b className="master-red">{fmt(s.late)}</b></div></div><div className="master-track"><i style={{width:s.pct+'%'}}/></div><small className="master-card-foot">{s.pct}% concluído</small></article>)}
      {!sectors.length&&!loading&&<div className="master-empty">Não há programação para este mês.</div>}
    </section>

    <section className="master-chart">
      <div className="master-section-kicker">PRODUÇÃO POR DIA E TURNO</div><h2>Produção por Dia e Turno – Corte Laser</h2>
      <div className="master-legend"><span><i className="shift-one"/>1º Turno</span><span><i className="shift-two"/>2º Turno</span></div>
      {daily.length?<div className="master-bars">{daily.map(d=><div className="master-bar-day" key={d.date}><div className="master-bar-values"><b>{fmt(d.first)}</b><b>{fmt(d.second)}</b></div><div className="master-bar-pair"><i className="shift-one" style={{height:Math.max(2,d.first/maxDaily*100)+'%'}}/><i className="shift-two" style={{height:Math.max(2,d.second/maxDaily*100)+'%'}}/></div><small>{dateBR(d.date)}</small></div>)}</div>:<div className="master-empty">Sem apontamentos registrados neste mês.</div>}
      <div className="master-shift-note"><span>1º turno: 07:00 às 17:15</span><span>2º turno: 17:20 às 02:48</span></div>
    </section>

    <section className="master-bottom-grid">
      <div className="master-audit">
        <div className="master-section-kicker">CONFERÊNCIA DA PRODUÇÃO</div><h2>Conferência de OPs – Corte Laser</h2>
        <p className="master-audit-help">A OP só aparece como concluída quando todos os processos programados para ela, naquela data, atingem 100%.</p>
        <div className="master-filters"><label>Data<input type="date" value={dayFilter} onChange={e=>setDayFilter(e.target.value)}/></label><label>Buscar OP<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número da OP"/></label><label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="TODAS">Todas</option><option>CONCLUÍDA</option><option>PARCIAL</option><option>ATRASADA</option><option>NÃO INICIADA</option></select></label><button onClick={()=>{setDayFilter('');setSearch('');setStatus('TODAS')}}>Limpar</button></div>
        <div className="master-audit-table-wrap"><table className="master-audit-table"><thead><tr><th>Data</th><th>OP</th><th>Processos / Etapas</th><th>Programada</th><th>Realizada</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>
          {audit.map(a=><tr key={a.key}><td>{dateBR(a.date)}</td><td className="master-op">{a.op}</td><td><div className="master-stage-list">{a.items.map(i=><span key={i.id} className={Number(i.reported_quantity)>=Number(i.planned_quantity)&&Number(i.planned_quantity)>0?'stage-done':''}>{label(i.process_type)} · {i.operation_type}: {fmt(Number(i.reported_quantity||0))}/{fmt(Number(i.planned_quantity||0))}</span>)}</div></td><td>{fmt(a.planned)}</td><td className="master-green">{fmt(a.done)}</td><td className={a.pending?'master-orange':''}>{fmt(a.pending)}</td><td><span className={'master-status '+a.state.toLowerCase().replaceAll(' ','-')}>{a.state}</span></td></tr>)}
          {!audit.length&&<tr><td colSpan={7} className="master-empty">Nenhuma OP encontrada com esses filtros.</td></tr>}
        </tbody></table></div>
        <div className="master-audit-foot">Exibindo {audit.length} OPs no mês selecionado. Quantidades consolidadas sem duplicar apontamentos.</div>
      </div>
      <aside className="master-late-panel"><div className="master-section-kicker">ATENÇÃO À PRODUÇÃO</div><h2>OPs do Corte Laser em atraso</h2><strong>{fmt(totals.late)}</strong><p>OPs com data vencida e saldo pendente</p><div className="master-late-pieces"><b>{fmt(totals.latePieces)}</b><span>peças pendentes nessas OPs</span></div><div className="master-late-divider"/><div className="master-shift-info"><b>◷　1º Turno</b><span>07:00 às 17:15</span><b>◷　2º Turno</b><span>17:20 às 02:48</span></div><small>Os indicadores são calculados a partir da programação e dos apontamentos registrados.</small></aside>
    </section>
    {loading&&<div className="master-loading">Carregando produção...</div>}
    {error&&<div className="master-error" role="alert">{error}</div>}
  </main></div>;
}
