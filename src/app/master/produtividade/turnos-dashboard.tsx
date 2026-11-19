'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = { id:number; process_type:string; operation_type:string; op_number:string; parent_op?:string|null; scheduled_date:string; planned_quantity:number; entries:Entry[] };
type Shift = 'first' | 'second';
type ShiftTotals = { first:number; second:number };
const PROCESS_ORDER = ['CORTE LASER','PLASMA','DOBRADEIRA','RADIADOR','PRENSA','BORDADEIRA'];
const PROCESS_NAMES:Record<string,string> = {
  'CORTE LASER':'Corte Laser', PLASMA:'Plasma', DOBRADEIRA:'Dobradeira', RADIADOR:'Radiador', PRENSA:'Prensa', BORDADEIRA:'Bordadeira'
};
const normalizeProcess = (value:string) => {
  const key=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
  if (key==='BORDEADEIRA' || key==='BORDADEIRA') return 'BORDADEIRA';
  if (key==='CORTE LASER' || key==='LASER') return 'CORTE LASER';
  return key;
};
const fmt = (n:number) => new Intl.NumberFormat('pt-BR').format(n || 0);
const pct = (n:number,d:number) => d ? Math.round(n/d*100) : 0;
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthStart = (value:string) => value.slice(0,7)+'-01';
const previousDay = (value:string) => {
  const date=new Date(value+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
};
function shiftInfo(value:string):{day:string;shift:Shift}|null {
  const date=new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Manaus',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(key:string)=>parts.find(part=>part.type===key)?.value||'00';
  const day=get('year')+'-'+get('month')+'-'+get('day');
  const minutes=Number(get('hour'))*60+Number(get('minute'));
  if (minutes>=420 && minutes<=1035) return {day,shift:'first'};
  if (minutes>=1040 || minutes<=168) return {day:minutes<=168?previousDay(day):day,shift:'second'};
  return null;
}
function dayLabel(value:string) {
  const [year,month,day]=value.split('-');
  return day+'/'+month;
}

export default function TurnosDashboard() {
  const [rows,setRows]=useState<Schedule[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [lastUpdated,setLastUpdated]=useState('');
  const [dateFrom,setDateFrom]=useState(monthStart(today()));
  const [dateTo,setDateTo]=useState(today());
  const [sector,setSector]=useState('TODOS');

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try {
      const response=await fetch('/api/master/production?refresh='+Date.now(),{cache:'no-store'});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error||'Falha ao carregar os apontamentos.');
      setRows(Array.isArray(data.rows)?data.rows:[]);
      setLastUpdated(data.generatedAt||new Date().toISOString());
    } catch (err:any) {
      setError(err?.message||'Não foi possível consultar os apontamentos.');
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible') void load();},15000);
    return ()=>window.clearInterval(timer);
  },[load]);

  const entries=useMemo(()=>{
    const grouped=new Map<string,Schedule[]>();
    rows.forEach(row=>{
      const normalized=normalizeProcess(row.process_type);
      if (!PROCESS_ORDER.includes(normalized)) return;
      const op=String(row.op_number||'').trim();
      if (!op) return;
      const scheduledDay=String(row.scheduled_date||'').slice(0,10);
      const key=[normalized,op,String(row.parent_op||''),scheduledDay].join('|');
      const list=grouped.get(key)||[];
      list.push(row);
      grouped.set(key,list);
    });

    const result:{sector:string;day:string;shift:Shift;quantity:number;at:string}[]=[];
    grouped.forEach(schedules=>{
      const completedStages=schedules.map(schedule=>{
        const target=Number(schedule.planned_quantity||0);
        if (!(target>0)) return null;
        const ordered=(Array.isArray(schedule.entries)?schedule.entries:[])
          .filter(entry=>entry.at && Number(entry.quantity||0)>0)
          .slice()
          .sort((a,b)=>String(a.at).localeCompare(String(b.at)));
        let accumulated=0;
        let completedAt:string|null=null;
        for (const entry of ordered) {
          accumulated+=Number(entry.quantity||0);
          if (accumulated>=target) { completedAt=String(entry.at); break; }
        }
        return completedAt;
      });
      // Uma OP só entra na produtividade quando todas as partes/etapas
      // programadas para aquele dia atingirem suas respectivas quantidades.
      if (!completedStages.length || completedStages.some(value=>!value)) return;
      const completionTimes=completedStages.map(value=>String(value)).sort();
      const completionAt=completionTimes[completionTimes.length-1];
      if (!completionAt) return;
      const info=shiftInfo(completionAt);
      if (!info || info.day<dateFrom || info.day>dateTo) return;
      const normalized=normalizeProcess(schedules[0].process_type);
      if (sector!=='TODOS' && normalized!==sector) return;
      // Corpo, tampa e fundo representam a mesma quantidade da OP:
      // contabiliza uma única vez, nunca soma as partes entre si.
      const quantity=Math.min(...schedules.map(schedule=>Number(schedule.planned_quantity||0)));
      if (quantity>0) result.push({sector:normalized,day:info.day,shift:info.shift,quantity,at:completionAt});
    });
    return result;
  },[rows,dateFrom,dateTo,sector]);

  const stageRows=useMemo(()=>{
    const grouped=new Map<string,{process:string;stage:string;first:number;second:number}>();
    rows.forEach(row=>{
      const process=normalizeProcess(row.process_type);
      if (!PROCESS_ORDER.includes(process) || (sector!=='TODOS' && process!==sector)) return;
      const stage=String(row.operation_type||'').trim()||'Etapa não informada';
      const key=process+'|'+stage;
      const value=grouped.get(key)||{process,stage,first:0,second:0};
      (Array.isArray(row.entries)?row.entries:[]).forEach(entry=>{
        if (!entry.at) return;
        const info=shiftInfo(entry.at);
        if (!info || info.day<dateFrom || info.day>dateTo) return;
        const quantity=Number(entry.quantity||0);
        if (!Number.isFinite(quantity)||quantity<=0) return;
        value[info.shift]+=quantity;
      });
      grouped.set(key,value);
    });
    return PROCESS_ORDER.flatMap(process=>Array.from(grouped.values())
      .filter(item=>item.process===process)
      .sort((a,b)=>a.stage.localeCompare(b.stage,'pt-BR'))
      .map(item=>({...item,total:item.first+item.second})));
  },[rows,dateFrom,dateTo,sector]);

  const stageGroups = useMemo(() => PROCESS_ORDER.flatMap(process => {
    const stages = stageRows.filter(item => item.process === process);
    if (!stages.length) return [];
    const first = stages.reduce((sum, item) => sum + item.first, 0);
    const second = stages.reduce((sum, item) => sum + item.second, 0);
    return [{
      key: process,
      name: PROCESS_NAMES[process],
      stages,
      first,
      second,
      total: first + second
    }];
  }), [stageRows]);

  const totals=useMemo(()=>{
    const byShift:ShiftTotals={first:0,second:0};
    const bySector=new Map<string,ShiftTotals>();
    const byDay=new Map<string,ShiftTotals>();
    entries.forEach(entry=>{
      byShift[entry.shift]+=entry.quantity;
      const sectorTotal=bySector.get(entry.sector)||{first:0,second:0};
      sectorTotal[entry.shift]+=entry.quantity;
      bySector.set(entry.sector,sectorTotal);
      const dayTotal=byDay.get(entry.day)||{first:0,second:0};
      dayTotal[entry.shift]+=entry.quantity;
      byDay.set(entry.day,dayTotal);
    });
    const sectors=PROCESS_ORDER.map(key=>{
      const value=bySector.get(key)||{first:0,second:0};
      return {key,name:PROCESS_NAMES[key],...value,total:value.first+value.second};
    });
    const daily=Array.from(byDay.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([day,value])=>({day,...value,total:value.first+value.second}));
    return {byShift,total:byShift.first+byShift.second,sectors,daily};
  },[entries]);

  const daily=totals.daily.slice(-14);
  const maxDaily=Math.max(1,...daily.map(item=>item.total));
  const firstShare=pct(totals.byShift.first,totals.total);
  const secondShare=pct(totals.byShift.second,totals.total);
  const periodLabel=dateFrom===dateTo?dayLabel(dateFrom):dayLabel(dateFrom)+' a '+dayLabel(dateTo);
  const programmedBySector = useMemo(() => {
    const grouped = new Map<string, Schedule[]>();
    rows.forEach(row => {
      const process = normalizeProcess(row.process_type);
      if (!PROCESS_ORDER.includes(process) || (sector !== 'TODOS' && process !== sector)) return;
      const op = String(row.op_number || '').trim();
      if (!op) return;
      const key = [process, op, String(row.parent_op || ''), String(row.scheduled_date || '').slice(0, 10)].join('|');
      const list = grouped.get(key) || [];
      list.push(row);
      grouped.set(key, list);
    });
    const result = new Map<string, number>();
    grouped.forEach((schedules, key) => {
      const process = key.split('|')[0];
      const quantities = schedules.map(item => Number(item.planned_quantity || 0)).filter(value => value > 0);
      const quantity = quantities.length ? Math.min(...quantities) : 0;
      result.set(process, (result.get(process) || 0) + quantity);
    });
    return result;
  }, [rows, sector]);
  const programmedTotal = Array.from(programmedBySector.values()).reduce((sum, value) => sum + value, 0);
  const overallProductivity = pct(totals.total, programmedTotal);
  const sectorRows = totals.sectors.filter(item => sector === 'TODOS' || item.key === sector);
  const maxDailyValue = Math.max(1, ...daily.map(item => item.total));

  return (
    <main className="master-page master-reference shift-page">
      <header className="master-heading">
        <img className="master-heading-background" src="https://raw.githubusercontent.com/lobato9785-hub/lucas001/main/public/estamparia-laser-header.webp" alt="" aria-hidden="true" />
        <div>
          <div className="master-breadcrumb">ITAM　›　MASTER - ESTAMPARIA</div>
          <h1>▣　Estamparia</h1>
          <p>Produtividade dos Turnos – Produção por apontamento</p>
        </div>
        <div className="master-head-actions">
          <span className="master-live">● Dados do banco{lastUpdated?' • '+new Date(lastUpdated).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</span>
          <button onClick={load} disabled={loading}>↻ Atualizar</button>
          <a href="/">Sair</a>
        </div>
      </header>

      <nav className="master-tabs" aria-label="Navegação MASTER">
        <a href="/master">▦　Visão Master</a>
        <a className="active" href="/master/produtividade">▥　Produtividade dos Turnos</a>
      </nav>

      <section className="shift-heading">
        <div>
          <div className="shift-eyebrow">ACOMPANHAMENTO DA PRODUÇÃO</div>
          <h2>Produtividade dos Turnos – Estamparia</h2>
          <p>Quantidade efetivamente apontada, separada por setor e turno.</p>
        </div>
        <div className="shift-filters">
          <label>Data (De)<input type="date" value={dateFrom} max={dateTo} onChange={e=>setDateFrom(e.target.value)} /></label>
          <label>Data (Até)<input type="date" value={dateTo} min={dateFrom} onChange={e=>setDateTo(e.target.value)} /></label>
          <label>Setor<select value={sector} onChange={e=>setSector(e.target.value)}><option value="TODOS">Todos</option>{PROCESS_ORDER.map(key=><option key={key} value={key}>{PROCESS_NAMES[key]}</option>)}</select></label>
          <button type="button" onClick={load} disabled={loading} title="Atualizar apontamentos">↻</button>
        </div>
      </section>

      {error&&<div className="shift-error" role="alert">{error}</div>}

      <section className="shift-kpis shift-kpis-reference">
        <article className="shift-kpi total"><span>▱　Produção Total (Apontada)</span><strong>{fmt(totals.total)} <small>peças</small></strong></article>
        <article className="shift-kpi programmed"><span>◎　Programado no Período</span><strong>{fmt(programmedTotal)} <small>peças</small></strong></article>
        <article className="shift-kpi productivity"><span>▥　Produtividade Geral</span><strong>{overallProductivity}%</strong></article>
        <article className="shift-kpi first"><span>☀　1º Turno</span><strong>{fmt(totals.byShift.first)} <small>peças</small></strong><small>{firstShare}% do realizado</small></article>
        <article className="shift-kpi second"><span>☾　2º Turno</span><strong>{fmt(totals.byShift.second)} <small>peças</small></strong><small>{secondShare}% do realizado</small></article>
      </section>

      <section className="shift-reference-grid">
        <article className="shift-panel shift-sector-panel">
          <header><div><span>▦</span><div><h3>Produtividade por Setor e Turno</h3><p>Quantidade apontada e produtividade em relação ao programado</p></div></div></header>
          <div className="shift-table-wrap">
            <table className="shift-table shift-reference-table">
              <thead>
                <tr><th rowSpan={2}>Setor</th><th rowSpan={2}>Programado</th><th colSpan={2} className="shift-first-head">1º Turno (07:00 – 17:15)</th><th colSpan={2} className="shift-second-head">2º Turno (17:20 – 02:48)</th><th rowSpan={2}>Total Apontado</th><th rowSpan={2}>Produtividade Total</th></tr>
                <tr><th>Apontado</th><th>Produtividade</th><th>Apontado</th><th>Produtividade</th></tr>
              </thead>
              <tbody>
                {sectorRows.map(item => {
                  const planned = programmedBySector.get(item.key) || 0;
                  return <tr key={item.key}>
                    <td><span className={'shift-dot '+item.key.toLowerCase().replaceAll(' ','-')}></span>{item.name}</td>
                    <td>{fmt(planned)}</td>
                    <td className="first-value">{fmt(item.first)}</td><td>{pct(item.first, planned)}%</td>
                    <td className="second-value">{fmt(item.second)}</td><td>{pct(item.second, planned)}%</td>
                    <td className="total-value">{fmt(item.total)}</td><td>{pct(item.total, planned)}%</td>
                  </tr>;
                })}
                <tr className="shift-total-row"><td>Total</td><td>{fmt(programmedTotal)}</td><td className="first-value">{fmt(totals.byShift.first)}</td><td>{pct(totals.byShift.first, programmedTotal)}%</td><td className="second-value">{fmt(totals.byShift.second)}</td><td>{pct(totals.byShift.second, programmedTotal)}%</td><td>{fmt(totals.total)}</td><td>{overallProductivity}%</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="shift-panel shift-reference-donut">
          <header><div><span>▥</span><div><h3>Participação da Produção por Turno</h3><p>Distribuição do total apontado</p></div></div></header>
          <div className="shift-donut-wrap">
            <div className="shift-donut" style={{'--first-share':firstShare+'%'} as React.CSSProperties}><div><strong>{fmt(totals.total)}</strong><small>peças</small></div></div>
            <div className="shift-donut-legend">
              <p><i className="first"></i><span>1º Turno – {fmt(totals.byShift.first)} peças ({firstShare}%)</span></p>
              <p><i className="second"></i><span>2º Turno – {fmt(totals.byShift.second)} peças ({secondShare}%)</span></p>
            </div>
          </div>
        </article>
      </section>

      <section className="shift-lower-grid shift-reference-lower">
        <article className="shift-panel shift-chart-panel">
          <header><div><span>▥</span><div><h3>Evolução da Produção por Turno (Diária)</h3><p>Quantidade apontada por dia e por turno</p></div></div></header>
          {daily.length ? <div className="shift-chart">
            <div className="shift-chart-legend"><span><i className="first"></i>1º Turno</span><span><i className="second"></i>2º Turno</span></div>
            <div className="shift-bars">
              {daily.map(item => <div className="shift-bar-group" key={item.day} title={dayLabel(item.day)+': '+fmt(item.total)+' peças'}>
                <div className="shift-bar-stack" style={{height:Math.max(4,item.total/maxDailyValue*100)+'%'}}>
                  <i className="second" style={{height:(item.second/item.total*100)+'%'}}></i>
                  <i className="first" style={{height:(item.first/item.total*100)+'%'}}></i>
                </div><small>{dayLabel(item.day)}</small>
              </div>)}
            </div>
          </div> : <div className="shift-empty">{loading?'Carregando apontamentos...':'Não há apontamentos nos turnos e período selecionados.'}</div>}
        </article>
        <article className="shift-panel shift-period-summary">
          <header><div><span>▦</span><div><h3>Resumo do Período</h3><p>Indicadores consolidados</p></div></div></header>
          <div className="shift-period-lines">
            <p><span>Programado</span><b>{fmt(programmedTotal)} peças</b></p>
            <p><span>Total Apontado</span><b>{fmt(totals.total)} peças</b></p>
            <p><span>Falta Produzir</span><b>{fmt(Math.max(0,programmedTotal-totals.total))} peças</b></p>
            <p><span>Produtividade Geral</span><b className="shift-productivity-pill">{overallProductivity}%</b></p>
          </div>
        </article>
      </section>

      <footer className="shift-footnote">
        <span>● Atualização automática a cada 15 segundos</span>
        <span>Apontamentos entre 00:00 e 02:48 pertencem ao dia de início do 2º turno.</span>
      </footer>
      {loading&&<div className="master-loading">Atualizando apontamentos...</div>}
    </main>
  );
}
