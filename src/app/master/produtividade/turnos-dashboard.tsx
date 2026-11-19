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
  if (key==='BORDEADEIRA' || key==='BORDADEIRA') return 'BORDADEIRA';
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
      const completionAt=completedStages.map(value=>String(value)).sort().at(-1)!;
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

  const stageGroups=useMemo(()=>PROCESS_ORDER.map(process=>{
    const stages=stageRows.filter(item=>item.process===process);
    const first=stages.reduce((sum,item)=>sum+item.first,0);
    const second=stages.reduce((sum,item)=>sum+item.second,0);
    return {key:process,name:PROCESS_NAMES[process],stages,first,second,total:first+second};
  }).filter(group=>group.stages.length>0),[stageRows]);

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
  const maxProcessTotal=Math.max(1,...stageGroups.map(group=>group.total));

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

      <section className="shift-detail-layout">
        <article className="shift-panel shift-sector-panel shift-detail-main">
          <header><div><span>▰</span><div><h3>Produção Detalhada por Processo e Etapa</h3><p>Apontamentos de cada etapa por turno, inclusive OPs em andamento</p></div></div><small>{fmt(stageRows.reduce((sum,item)=>sum+item.total,0))} apontamentos de etapa</small></header>
          <div className="shift-table-wrap">
            <table className="shift-table shift-detail-table">
              <thead>
                <tr><th rowSpan={2}>Processo</th><th rowSpan={2}>Etapa</th><th colSpan={2} className="shift-first-head">1º Turno · 07:00–17:15</th><th colSpan={2} className="shift-second-head">2º Turno · 17:20–02:48</th><th colSpan={2}>Total</th></tr>
                <tr><th>Qtde</th><th>%</th><th>Qtde</th><th>%</th><th>Qtde</th><th>%</th></tr>
              </thead>
              <tbody>
                {stageGroups.map(group=><React.Fragment key={group.key}>
                  {group.stages.map((item,index)=><tr key={group.key+'-'+item.stage}>
                    {index===0&&<td rowSpan={group.stages.length+1} className="shift-process-cell"><span className={'shift-dot '+group.key.toLowerCase().replaceAll(' ','-')}></span><b>{group.name}</b></td>}
                    <td className="shift-stage-name">{item.stage}</td>
                    <td className="first-value">{fmt(item.first)}</td><td className="shift-percent">{pct(item.first,group.first)}%</td>
                    <td className="second-value">{fmt(item.second)}</td><td className="shift-percent">{pct(item.second,group.second)}%</td>
                    <td className="total-value">{fmt(item.total)}</td><td className="shift-percent">{pct(item.total,group.total)}%</td>
                  </tr>)}
                  <tr className="shift-subtotal-row"><td>Subtotal {group.name}</td><td className="first-value">{fmt(group.first)}</td><td>{group.first?'100%':'0%'}</td><td className="second-value">{fmt(group.second)}</td><td>{group.second?'100%':'0%'}</td><td>{fmt(group.total)}</td><td>100%</td></tr>
                </React.Fragment>)}
                {!stageGroups.length&&<tr><td colSpan={8} className="shift-empty">Não há apontamentos nas etapas para o período selecionado.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="shift-filter-note">As quantidades por etapa incluem apontamentos parciais. Os indicadores de produtividade contam cada OP uma única vez, somente quando todas as etapas previstas forem concluídas.</p>
        </article>
        <aside className="shift-detail-side">
          <article className="shift-panel shift-process-summary">
            <header><div><span>▤</span><div><h3>Resumo por Processo</h3><p>Soma dos apontamentos de cada etapa</p></div></div></header>
            {stageGroups.map(group=><div className="shift-process-summary-row" key={group.key}><b>{group.name}</b><strong>{fmt(group.total)}</strong><div><i style={{width:(group.total/maxProcessTotal*100)+'%'}}/></div></div>)}
            <div className="shift-process-summary-total"><b>Total de etapas</b><strong>{fmt(stageRows.reduce((sum,item)=>sum+item.total,0))}</strong></div>
          </article>
          <article className="shift-panel shift-summary-panel">
            <header><div><span>◔</span><div><h3>Participação por Turno</h3><p>Total de OPs concluídas</p></div></div></header>
            <div className="shift-donut-wrap">
              <div className="shift-donut" style={{'--first-share':firstShare+'%'} as React.CSSProperties}><div><strong>{fmt(totals.total)}</strong><small>peças</small></div></div>
              <div className="shift-donut-legend"><p><i className="first"></i><span>1º Turno</span><b>{fmt(totals.byShift.first)}</b><small>{firstShare}%</small></p><p><i className="second"></i><span>2º Turno</span><b>{fmt(totals.byShift.second)}</b><small>{secondShare}%</small></p></div>
            </div>
          </article>
        </aside>
      </section>

      <section className="shift-lower-grid">
        <article className="shift-panel shift-chart-panel">
          <header><div><span>▥</span><div><h3>Evolução Diária da Produção</h3><p>Quantidade de OPs concluídas por turno · últimos 14 dias</p></div></div></header>
          {daily.length? <div className="shift-chart">
            <div className="shift-chart-legend"><span><i className="first"></i>1º Turno</span><span><i className="second"></i>2º Turno</span></div>
            <div className="shift-bars">
              {daily.map(item=><div className="shift-bar-group" key={item.day} title={dayLabel(item.day)+': '+fmt(item.total)+' peças'}>
                <div className="shift-bar-stack" style={{height:Math.max(4,item.total/maxDaily*100)+'%'}}>
                  <i className="second" style={{height:item.second/item.total*100+'%'}></i><i className="first" style={{height:item.first/item.total*100+'%'}}></i>
                </div><small>{dayLabel(item.day)}</small><b>{fmt(item.total)}</b>
              </div>)}
            </div>
          </div>:<div className="shift-empty">{loading?'Carregando apontamentos...':'Não há apontamentos nos turnos e período selecionados.'}</div>}
        </article>
        <article className="shift-panel shift-period-summary">
          <header><div><span>▦</span><div><h3>Resumo do Período</h3><p>Indicadores consolidados</p></div></div></header>
          <div className="shift-period-lines">
            <p><span>Produção total concluída</span><b>{fmt(totals.total)} peças</b></p>
            <p><span>Produção do 1º turno</span><b>{fmt(totals.byShift.first)} peças</b></p>
            <p><span>Produção do 2º turno</span><b>{fmt(totals.byShift.second)} peças</b></p>
            <p><span>Dias com produção</span><b>{fmt(totals.daily.length)}</b></p>
            <p><span>Período consultado</span><b>{periodLabel}</b></p>
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
