'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Entry = { id:number; quantity:number; operator?:string; note?:string; at?:string };
type Schedule = { process_type:string; entries:Entry[] };
type Shift = 'first' | 'second';
type ShiftTotals = { first:number; second:number };
const PROCESS_ORDER = ['CORTE LASER','RADIADOR','PRENSA','BORDADEIRA'];
const PROCESS_NAMES:Record<string,string> = {
  'CORTE LASER':'Corte Laser', RADIADOR:'Radiador', PRENSA:'Prensa', BORDADEIRA:'Bordadeira'
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
    const result:{sector:string;day:string;shift:Shift;quantity:number;op?:string;at:string}[]=[];
    rows.forEach(row=>{
      const normalized=normalizeProcess(row.process_type);
      if (!PROCESS_ORDER.includes(normalized)) return;
      if (sector!=='TODOS' && normalized!==sector) return;
      (Array.isArray(row.entries)?row.entries:[]).forEach(entry=>{
        if (!entry.at) return;
        const info=shiftInfo(entry.at);
        if (!info || info.day<dateFrom || info.day>dateTo) return;
        const quantity=Number(entry.quantity||0);
        if (!Number.isFinite(quantity)||quantity<=0) return;
        result.push({sector:normalized,day:info.day,shift:info.shift,quantity,at:String(entry.at)});
      });
    });
    return result;
  },[rows,dateFrom,dateTo,sector]);

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

      <section className="shift-kpis">
        <article className="shift-kpi total">
          <span>PRODUÇÃO TOTAL APONTADA</span>
          <strong>{fmt(totals.total)}</strong>
          <small>peças no período selecionado</small>
        </article>
        <article className="shift-kpi first">
          <span>☀　1º TURNO</span>
          <strong>{fmt(totals.byShift.first)}</strong>
          <small>07:00 – 17:15 · {firstShare}% da produção</small>
        </article>
        <article className="shift-kpi second">
          <span>☾　2º TURNO</span>
          <strong>{fmt(totals.byShift.second)}</strong>
          <small>17:20 – 02:48 · {secondShare}% da produção</small>
        </article>
        <article className="shift-kpi days">
          <span>DIAS COM PRODUÇÃO</span>
          <strong>{fmt(totals.daily.length)}</strong>
          <small>{periodLabel}</small>
        </article>
      </section>

      <section className="shift-panel shift-sector-panel">
        <header><div><span>▰</span><div><h3>Produtividade por Setor e Turno</h3><p>Peças apontadas em cada setor durante o período</p></div></div><small>{fmt(totals.total)} peças apontadas</small></header>
        <div className="shift-table-wrap">
          <table className="shift-table">
            <thead><tr><th>Setor</th><th>1º Turno<br/><small>07:00 – 17:15</small></th><th>2º Turno<br/><small>17:20 – 02:48</small></th><th>Total Apontado</th><th>Participação 1º / 2º</th></tr></thead>
            <tbody>
              {totals.sectors.map(item=><tr key={item.key}>
                <td><span className={'shift-dot '+item.key.toLowerCase().replaceAll(' ','-')}></span><b>{item.name}</b></td>
                <td className="first-value">{fmt(item.first)}</td>
                <td className="second-value">{fmt(item.second)}</td>
                <td className="total-value">{fmt(item.total)}</td>
                <td><div className="shift-share"><span style={{width:pct(item.first,item.total)+'%'}}></span><i style={{width:pct(item.second,item.total)+'%'}}></i></div><small>{pct(item.first,item.total)}% / {pct(item.second,item.total)}%</small></td>
              </tr>)}
              <tr className="shift-total-row"><td>Total Geral</td><td>{fmt(totals.byShift.first)}</td><td>{fmt(totals.byShift.second)}</td><td>{fmt(totals.total)}</td><td>{firstShare}% / {secondShare}%</td></tr>
            </tbody>
          </table>
        </div>
        {sector!=='TODOS'&&<p className="shift-filter-note">Exibindo somente {PROCESS_NAMES[sector]}.</p>}
      </section>

      <section className="shift-lower-grid">
        <article className="shift-panel shift-chart-panel">
          <header><div><span>▥</span><div><h3>Evolução Diária da Produção</h3><p>Quantidade apontada por turno · últimos 14 dias com produção</p></div></div></header>
          {daily.length? <div className="shift-chart">
            <div className="shift-chart-legend"><span><i className="first"></i>1º Turno</span><span><i className="second"></i>2º Turno</span></div>
            <div className="shift-bars">
              {daily.map(item=><div className="shift-bar-group" key={item.day} title={dayLabel(item.day)+': '+fmt(item.total)+' peças'}>
                <div className="shift-bar-stack" style={{height:Math.max(4,item.total/maxDaily*100)+'%'}}>
                  <i className="second" style={{height:item.second/item.total*100+'%'}}></i>
                  <i className="first" style={{height:item.first/item.total*100+'%'}}></i>
                </div>
                <small>{dayLabel(item.day)}</small>
                <b>{fmt(item.total)}</b>
              </div>)}
            </div>
          </div>:<div className="shift-empty">{loading?'Carregando apontamentos...':'Não há apontamentos nos turnos e período selecionados.'}</div>}
        </article>

        <article className="shift-panel shift-summary-panel">
          <header><div><span>▤</span><div><h3>Resumo do Período</h3><p>Participação de cada turno</p></div></div></header>
          <div className="shift-donut-wrap">
            <div className="shift-donut" style={{'--first-share':firstShare+'%'} as React.CSSProperties}><div><strong>{fmt(totals.total)}</strong><small>peças</small></div></div>
            <div className="shift-donut-legend"><p><i className="first"></i><span>1º Turno</span><b>{fmt(totals.byShift.first)}</b><small>{firstShare}%</small></p><p><i className="second"></i><span>2º Turno</span><b>{fmt(totals.byShift.second)}</b><small>{secondShare}%</small></p></div>
          </div>
          <div className="shift-summary-foot"><span>Período consultado</span><b>{periodLabel}</b></div>
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
