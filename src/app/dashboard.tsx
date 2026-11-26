'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

type Entry = {id:number;quantity:number;operator?:string;note?:string;at?:string};
type Stage = {id:number;planned:number;reported:number;entries:Entry[]};
type Row = {key:string;date:string;op:string;parentOp:string;client:string;reference:string;line:string;power:string;orderQty:number;series:string;stages:Record<string,Stage>};
const STAGES_BY_SECTOR:Record<string,string[]>={'CORTE LASER':['CORPO','FUNDO','TAMPA'],'RADIADOR':['CORTE','DOBRA','ESTAMPAGEM','RADIADOR SOLDADO'],'BORDEADEIRA':['BORDA','ESTAMPAGEM','NÚMERO DE SÉRIE'],'PRENSA':['PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE','CORPO NÚMERO DE SÉRIE'],'PLASMA + DOBRADEIRA':['FERRAGEM SUPERIOR','FERRAGEM INFERIOR','DOBRA SUPERIOR','DOBRA INFERIOR']};
const SECTORS=['CORTE LASER','RADIADOR','BORDEADEIRA','PRENSA'];
const fmt=(n:number)=>new Intl.NumberFormat('pt-BR').format(n||0);
const todayKey=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const dateBR=(s:string)=>{const d=new Date(s+'T00:00:00');return Number.isNaN(+d)?s:d.toLocaleDateString('pt-BR')};
const monthKey=(d:Date)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
const esc=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export default function Dashboard({initialSector='CORTE LASER',restrictedAccess=false}:{initialSector?:string;restrictedAccess?:boolean}={}){
 const [sector,setSector]=useState(initialSector),[raw,setRaw]=useState<any[]>([]),[month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const requestVersion=useRef(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[importBusy,setImportBusy]=useState<''|'FERRAGEM'|'DEMAIS'>(''),[search,setSearch]=useState(''),[parent,setParent]=useState(''),[series,setSeries]=useState(''),[client,setClient]=useState(''),[power,setPower]=useState(''),[line,setLine]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[statusFilter,setStatusFilter]=useState(''),[sort,setSort]=useState('asc');
 const stages=STAGES_BY_SECTOR[sector]||[];
 const visibleSectors=restrictedAccess?['PLASMA + DOBRADEIRA']:SECTORS;
 const [modal,setModal]=useState<Row|null>(null),[amounts,setAmounts]=useState<Record<string,string>>({}),[operator,setOperator]=useState(''),[note,setNote]=useState(''),[activeStage,setActiveStage]=useState(''),[editTarget,setEditTarget]=useState<{id:number;scheduleId:number;stage:string;quantity:number;operator:string;note:string}|null>(null),[busy,setBusy]=useState(false),[settings,setSettings]=useState(false),[page,setPage]=useState(1);
 async function load(targetSector=sector,signal?:AbortSignal){
  const version=++requestVersion.current;
  setLoading(true);setError('');
  try{
   const r=await fetch('/api/production?sector='+encodeURIComponent(targetSector),{cache:'no-store',signal});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error||'Falha ao carregar');
   if(version===requestVersion.current&&!signal?.aborted)setRaw(j.rows||[]);
  }catch(e:any){
   if(version===requestVersion.current&&e?.name!=='AbortError'&&!signal?.aborted)setError(e.message||'Erro ao carregar produção');
  }finally{
   if(version===requestVersion.current&&!signal?.aborted)setLoading(false);
  }
 }
 useEffect(()=>{
  const controller=new AbortController();
  setRaw([]);
  setLoading(true);
  setError('');
  void load(sector,controller.signal);
  return ()=>controller.abort();
 },[sector]);
 const rows=useMemo<Row[]>(()=>{const map=new Map<string,Row>();for(const x of raw){const day=String(x.scheduled_date).slice(0,10),key=[day,x.op_number,x.series_start||'',x.series_end||''].join('|');let r=map.get(key);if(!r){r={key,date:day,op:String(x.op_number||''),parentOp:String(x.parent_op||x.op_number||''),client:x.client_name||'',reference:x.product_reference||x.product_description||'',line:x.production_line||'',power:x.power_pa||'',orderQty:Number(x.order_quantity||0),series:[x.series_start,x.series_end].filter(Boolean).join('–'),stages:{}};map.set(key,r)}const rawStage=String(x.operation_type||'').toUpperCase();const stage=rawStage==='DOBRA'&&sector==='PLASMA + DOBRADEIRA'?'DOBRA INFERIOR':rawStage;if(stages.includes(stage))r.stages[stage]={id:Number(x.id),planned:Number(x.planned_quantity||0),reported:Number(x.reported_quantity||0),entries:x.entries||[]};}return [...map.values()]},[raw,stages]);
 const getStatus=(r:Row)=>{const stageData=stages.map(s=>stageFor(r,s)),total=stageData.reduce((n,s)=>n+(s?.reported||0),0);if(stageData.length>0&&stageData.every(s=>(s?.planned||0)>0&&(s?.reported||0)>=(s?.planned||0)))return 'Concluída';if(total>0)return 'Em andamento';if(r.date<todayKey())return 'Atrasada';return 'Não iniciada'};
 const filtered=useMemo(()=>rows.filter(r=>{const m=monthKey(month);if(!r.date.startsWith(m))return false;const st=getStatus(r),total=stages.reduce((n,s)=>n+(stageFor(r,s)?.reported||0),0),late=r.date<todayKey();const matchesStatus=!statusFilter||(statusFilter==='Atrasada'?late&&st!=='Concluída':statusFilter==='Em andamento'?total>0&&st!=='Concluída':st===statusFilter);const q=[search,parent,series,client].filter(Boolean).join(' ').toLowerCase();return (!q||[r.op,r.parentOp,r.series,r.client,r.reference].join(' ').toLowerCase().includes(q))&&(!power||r.power===power)&&(!line||r.line===line)&&(!from||r.date>=from)&&(!to||r.date<=to)&&matchesStatus}).sort((a,b)=>sort==='desc'?b.date.localeCompare(a.date):sort==='op'?a.op.localeCompare(b.op):a.date.localeCompare(b.date)),[rows,month,search,parent,series,client,power,line,from,to,statusFilter,sort,stages]);
 const monthRows=useMemo(()=>rows.filter(r=>r.date.startsWith(monthKey(month))),[rows,month]);
 const counts=useMemo(()=>{let c={doing:0,late:0,done:0,waiting:0};monthRows.forEach(r=>{const st=getStatus(r),total=stages.reduce((n,s)=>n+(stageFor(r,s)?.reported||0),0),isLate=r.date<todayKey();if(st==='Concluída')c.done++;else{if(total>0)c.doing++;if(isLate)c.late++;if(total===0&&!isLate)c.waiting++}});return c},[monthRows,stages]);
 function stageFor(r:Row,stage:string):Stage|undefined {
  const existing=r.stages[stage];if(existing&&!(sector==='PRENSA'&&existing.planned<=0))return existing;
  const source=raw.find(x=>String(x.operation_type||'').trim().toUpperCase()===stage&&String(x.op_number||'')===r.op&&String(x.scheduled_date||'').slice(0,10)===r.date&&String(x.series_start||'')===(r.series.split('–')[0]||'')&&String(x.series_end||'')===(r.series.split('–')[1]||''));
  if(source&&!(sector==='PRENSA'&&Number(source.planned_quantity||0)<=0))return {id:Number(source.id),planned:Number(source.planned_quantity||0),reported:Number(source.reported_quantity||0),entries:source.entries||[]};
  if(sector==='PRENSA'&&['PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE','CORPO NÚMERO DE SÉRIE'].includes(stage)){
   const planned=Math.max(0,...Object.values(r.stages).map(x=>x.planned||0));
   return {id:0,planned,reported:0,entries:[]};
  }
  if(sector==='RADIADOR'&&stage==='RADIADOR SOLDADO'){
   const planned=Math.max(0,...Object.values(r.stages).map(x=>x.planned||0));
   return {id:0,planned,reported:0,entries:[]};
  }
  if(sector==='PLASMA + DOBRADEIRA'&&['FERRAGEM SUPERIOR','FERRAGEM INFERIOR','DOBRA SUPERIOR','DOBRA INFERIOR'].includes(stage)){
   const planned=Math.max(0,...Object.values(r.stages).map(x=>x.planned||0));
   return {id:0,planned,reported:0,entries:[]};
  }
  return undefined;
 }
 const pageSize=12,shown=filtered.slice((page-1)*pageSize,page*pageSize);
 function clear(){setSearch('');setParent('');setSeries('');setClient('');setPower('');setLine('');setFrom('');setTo('');setStatusFilter('');setPage(1)}
 function openPoint(r:Row,stage?:string){setModal(r);setActiveStage(stage||'');setEditTarget(null);setAmounts({});setOperator('');setNote('')}
 function openEdit(r:Row){const found=stages.flatMap(stage=>(r.stages[stage]?.entries||[]).map(entry=>({id:entry.id,scheduleId:r.stages[stage].id,stage,quantity:entry.quantity,operator:entry.operator||'',note:entry.note||''})));setModal(r);setActiveStage(found[0]?.stage||'');setEditTarget(found[0]||null);setAmounts(found[0]?{[found[0].stage]:String(found[0].quantity)}:{});setOperator(found[0]?.operator||'');setNote(found[0]?.note||'')}
 async function save(){if(!modal)return;setBusy(true);try{let res:Response;if(editTarget){const quantity=Number(amounts[editTarget.stage]||0);if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error('Informe uma quantidade válida para editar.');res=await fetch('/api/production',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryId:editTarget.id,quantity,operator,note})})}else{const selected=stages;const entries=selected.filter(stage=>Number(amounts[stage]||0)>0).map(stage=>{const st=stageFor(modal,stage);return {scheduleId:st?.id||undefined,createSchedule:(sector==='RADIADOR'||sector==='PRENSA'||sector==='BORDEADEIRA'||restrictedAccess)?{operationType:stage,processType:sector==='RADIADOR'?'RADIADOR':sector==='PRENSA'?'PRENSA':sector==='BORDEADEIRA'?'BORDEADEIRA':stage.startsWith('FERRAGEM')?'PLASMA':'DOBRADEIRA',opNumber:modal.op,scheduledDate:modal.date,seriesStart:modal.series.split('–')[0]||'',seriesEnd:modal.series.split('–')[1]||''}:undefined,quantity:Number(amounts[stage]),operator,note}}).filter(e=>e.scheduleId||e.createSchedule);if(!entries.length)throw new Error('Informe ao menos uma quantidade para apontar.');res=await fetch('/api/production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries})})}const j=await res.json();if(!res.ok)throw new Error(j.error||'Falha ao salvar');setModal(null);setEditTarget(null);await load()}catch(e:any){alert(e.message||'Erro ao salvar')}finally{setBusy(false)}}
 async function importWorkbook(file:File,fileType:'FERRAGEM'|'DEMAIS'){
  setImportBusy(fileType);
  try{
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
   const imported:any[]=[];
   const map:Record<string,{process_type:string;operation_type:string}>={
    'FERRAGEM':{process_type:'PLASMA',operation_type:'FERRAGEM INFERIOR'},
    'ESTAMP. TANQUE/TAMPA':{process_type:'BORDEADEIRA',operation_type:'ESTAMPAGEM'},
    'ESTAMPAGEM TANQUE/TAMPA':{process_type:'BORDEADEIRA',operation_type:'ESTAMPAGEM'},
    'CORPO':{process_type:'CORTE LASER',operation_type:'CORPO'},'FUNDO':{process_type:'CORTE LASER',operation_type:'FUNDO'},'TAMPA':{process_type:'CORTE LASER',operation_type:'TAMPA'},
    'CORTE':{process_type:'RADIADOR',operation_type:'CORTE'},'DOBRA':{process_type:'RADIADOR',operation_type:'DOBRA'},'ESTAMPAGEM':{process_type:'RADIADOR',operation_type:'ESTAMPAGEM'},'RADIADOR SOLDADO':{process_type:'RADIADOR',operation_type:'RADIADOR SOLDADO'},'RADIADOR SOLDADO ': {process_type:'RADIADOR',operation_type:'RADIADOR SOLDADO'},
    'BORDA':{process_type:'BORDEADEIRA',operation_type:'BORDA'},'NÚMERO DE SÉRIE':{process_type:'BORDEADEIRA',operation_type:'NÚMERO DE SÉRIE'},
    'PARA RAIO':{process_type:'PRENSA',operation_type:'PARA RAIO'},'SUPORTE DE PLACA':{process_type:'PRENSA',operation_type:'SUPORTE DE PLACA'},'SUPORTE DE POSTE':{process_type:'PRENSA',operation_type:'SUPORTE DE POSTE'},
    'CORPO NÚMERO DE SÉRIE':{process_type:'PRENSA',operation_type:'CORPO NÚMERO DE SÉRIE'},'CORPO NUMERO DE SERIE':{process_type:'PRENSA',operation_type:'CORPO NÚMERO DE SÉRIE'},
    'FERRAGEM INFERIOR':{process_type:'PLASMA',operation_type:'FERRAGEM INFERIOR'},'FERRAGEM SUPERIOR':{process_type:'PLASMA',operation_type:'FERRAGEM SUPERIOR'},'DOBRADEIRA':{process_type:'DOBRADEIRA',operation_type:'DOBRA'}
   };
   for(const name of wb.SheetNames){
    const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name],{header:1,raw:true,defval:''});
    const hi=matrix.findIndex((r:any[])=>r.some(v=>String(v||'').trim()==='Nro OP'));if(hi<0)continue;
    const headers=matrix[hi].map((v:any)=>String(v||'').trim()),ix=(n:string)=>headers.indexOf(n),val=(r:any[],n:string)=>ix(n)<0?'':r[ix(n)];
    for(const r of matrix.slice(hi+1)){
     const op=String(val(r,'Nro OP')??'').trim(),activity=String(val(r,'Descr.Atividade')||'').trim().toUpperCase(),m=map[activity];
     if(!op||!m||(fileType==='FERRAGEM'&&activity!=='FERRAGEM')||(fileType==='DEMAIS'&&activity==='FERRAGEM'))continue;
     const rawDate=val(r,'Dt.Programada');let date='';
     if(rawDate instanceof Date)date=rawDate.toISOString().slice(0,10);
     else if(typeof rawDate==='number'){const d=XLSX.SSF.parse_date_code(rawDate);if(d)date=[d.y,String(d.m).padStart(2,'0'),String(d.d).padStart(2,'0')].join('-');}
     else {const t=String(rawDate||'').trim();if(/^\d{4}-\d{2}-\d{2}/.test(t))date=t.slice(0,10);else {const d=new Date(t);if(!Number.isNaN(+d))date=d.toISOString().slice(0,10);}}
     if(!date)continue;
     const num=(v:any)=>{const n=typeof v==='number'?v:Number(String(v??'').trim().replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0;};
     const base={op_number:op,parent_op:String(val(r,'OP-Pai')||op),scheduled_date:date,series_start:String(val(r,'Série Inicial')??''),series_end:String(val(r,'Série Final')??''),client_name:String(val(r,'Nome Cliente')||''),client_code:String(val(r,'Cód.Cli')||''),product_reference:String(val(r,'Referência Prod.')||''),product_description:String(val(r,'Descr.Produto')||''),production_line:String(val(r,'Linha Prod')||''),power_pa:String(val(r,'Potência PA')||''),order_quantity:num(val(r,'Qtd.OP')),planned_quantity:num(val(r,'Qtd.Programada'))};
     if(fileType==='FERRAGEM'&&activity==='FERRAGEM'){
      imported.push({...base,process_type:'PLASMA',operation_type:'FERRAGEM SUPERIOR'});
      imported.push({...base,process_type:'PLASMA',operation_type:'FERRAGEM INFERIOR'});
      imported.push({...base,process_type:'DOBRADEIRA',operation_type:'DOBRA SUPERIOR'});
      imported.push({...base,process_type:'DOBRADEIRA',operation_type:'DOBRA INFERIOR'});
     }else imported.push({...base,process_type:m.process_type,operation_type:m.operation_type});
    }
   }
   if(!imported.length)throw new Error('Nenhuma linha válida encontrada para esta planilha.');
   const res=await fetch('/api/production/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileType,rows:imported})}),out=await res.json();
   if(!res.ok)throw new Error(out.error||'Falha ao adicionar planilha');
   alert('Programação atualizada: '+out.imported+' registros incluídos/atualizados; '+out.archived+' programações antigas retiradas da visualização; '+out.movedEntries+' apontamentos reaproveitados.');
   setSettings(false);await load();
  }catch(e:any){alert(e.message||'Erro ao adicionar planilha.')}finally{setImportBusy('')}
 }
 const clients=[...new Set(rows.map(r=>r.client).filter(Boolean))].sort(),powers=[...new Set(rows.map(r=>r.power).filter(Boolean))].sort(),lines=[...new Set(rows.map(r=>r.line).filter(Boolean))].sort();
 const stageStatus=(r:Row)=>getStatus(r);
 return <main className="app production-theme">
  <header className="topbar"><div className="searchbox"><span>⌕</span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Buscar por OP, cliente, referência ou série..."/></div><a className="access-link" href="/">{ "↔ Trocar setor" }</a><button className="settings" onClick={()=>setSettings(true)}>☷ <span>Configurações</span></button></header>
  <div className="workspace"><aside className="sidebar"><div className="sidebrand"><span className="brandmark">E</span><div><b>ESTAMPARIA</b><small>CHÃO DE FÁBRICA</small></div></div><div className="sidetitle">SETORES</div><nav className="sector-nav">{visibleSectors.map((s,i)=><button key={s} className={sector===s?"active":""} onClick={()=>{if(s!==sector){setRaw([]);setLoading(true);setError('')}setSector(s);setPage(1)}}><span className="navicon">{["◫","◈","▤","▦","▧","▥"][i]}</span>{s}{sector===s&&<i/>}</button>)}</nav><div className="sidebar-foot"><span className="online-dot"/> Sistema conectado</div></aside><div className="mainpanel"><section className="content"><div className="eyebrow"><i/> CHÃO DE FÁBRICA <b>/</b> ESTAMPARIA <span className="connection"><i/> {loading?'Atualizando':'Conectado'} <button className="refresh" onClick={()=>load()}>⟳</button></span></div>
  <div className="heading"><div className="heading-copy"><h1>Visão da produção</h1><p>{restrictedAccess?'Aponte FERRAGEM INFERIOR, FERRAGEM SUPERIOR e DOBRA por dia.':'Da programação à peça pronta. Acompanhe também o Radiador.'}</p></div><div className="heading-side"><div className="holiday-greeting" aria-label="Feliz Natal e Próspero Ano Novo"><div className="holiday-greeting-text"><span>Feliz Natal e</span><strong>Próspero Ano Novo!</strong></div><svg className="holiday-art" viewBox="0 0 300 190" role="img" aria-label="Presentes de Natal com laços de cetim, ramos de pinheiro e enfeites">
<defs>
 <linearGradient id="giftRuby" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff8271"/><stop offset=".28" stopColor="#d92736"/><stop offset="1" stopColor="#781323"/></linearGradient>
 <linearGradient id="giftGold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff5c9"/><stop offset=".32" stopColor="#e9bd62"/><stop offset=".7" stopColor="#bd812b"/><stop offset="1" stopColor="#80501c"/></linearGradient>
 <linearGradient id="giftGreen" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#40a878"/><stop offset=".5" stopColor="#087044"/><stop offset="1" stopColor="#03402d"/></linearGradient>
 <linearGradient id="giftRibbon" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#fff1c1"/><stop offset=".22" stopColor="#d5a044"/><stop offset=".5" stopColor="#fff0bd"/><stop offset=".78" stopColor="#c28a32"/><stop offset="1" stopColor="#fff1c1"/></linearGradient>
 <linearGradient id="giftRedRibbon" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#ffd5aa"/><stop offset=".5" stopColor="#fff0d0"/><stop offset="1" stopColor="#d6a45c"/></linearGradient>
 <filter id="giftShadow" x="-30%" y="-40%" width="160%" height="190%"><feGaussianBlur stdDeviation="4"/></filter>
 <filter id="giftShine"><feGaussianBlur stdDeviation="1.2"/></filter>
</defs>
<ellipse cx="151" cy="173" rx="126" ry="10" fill="#183b2c" opacity=".2" filter="url(#giftShadow)"/>
<!-- pine branches -->
<g fill="none" strokeLinecap="round" strokeLinejoin="round">
 <path d="M25 162Q35 86 85 15M38 126L8 104M43 108L13 80M52 84L26 57M62 61L45 34M34 137L68 121M43 111L79 101M54 84L88 77" stroke="#075537" strokeWidth="4"/>
 <path d="M270 165Q255 88 216 16M260 130L291 105M253 108L284 79M244 83L270 55M234 60L252 32M265 140L230 121M255 112L220 100M245 85L211 75" stroke="#075537" strokeWidth="4"/>
</g>
<g fill="#0d7046">
 <path d="M25 161l8-49 14 37 25-24-29 44zM41 119L9 89l36 12 1-34 18 39zM59 79L40 40l31 26 12-31 3 47zM270 164l-8-49-14 37-25-24 29 44zM254 119l32-30-36 12-1-34-18 39zM236 79l19-39-31 26-12-31-3 47z"/>
</g>
<g fill="#1a8654" opacity=".85"><path d="M17 112l-10-20 26 14zM49 88L34 63l28 16zM74 49L66 22l20 24zM282 111l10-20-26 14zM251 87l15-25-28 16zM226 49l8-27-20 24z"/></g>
<!-- hanging baubles -->
<g>
 <path d="M49 42v-10M249 44V31" stroke="#bd8a35" strokeWidth="2.5"/>
 <circle cx="49" cy="52" r="11" fill="url(#giftRuby)" stroke="#8e1726" strokeWidth="1.4"/><ellipse cx="45" cy="48" rx="3" ry="5" fill="#fff" opacity=".36"/>
 <circle cx="249" cy="55" r="11" fill="url(#giftGold)" stroke="#a86d20" strokeWidth="1.4"/><ellipse cx="245" cy="51" rx="3" ry="5" fill="#fff" opacity=".48"/>
 <path d="M45 39h8M245 42h8" stroke="#e6c276" strokeWidth="3" strokeLinecap="round"/>
</g>
<!-- back gold present -->
<g>
 <path d="M177 95l64 4v61l-64-5z" fill="#9a641d" opacity=".25"/>
 <path d="M174 91l63 3v62l-63-4z" fill="url(#giftGold)" stroke="#99621c" strokeWidth="1.5"/>
 <path d="M197 92l13 1v62l-13-1z" fill="url(#giftRibbon)"/>
 <path d="M170 84l72 4v13l-72-4z" fill="#c28b32" stroke="#87551c" strokeWidth="1.4"/>
 <path d="M197 85l13 1v13l-13-1z" fill="#fff0bd"/>
 <path d="M203 85C180 81 178 65 188 62c7-2 13 7 16 19 5-15 18-23 25-15 7 8-8 20-26 19z" fill="url(#giftRibbon)" stroke="#a46d25" strokeWidth="1.5"/>
 <path d="M202 83c-12-10-16-17-12-20m14 20c9-13 17-17 22-15" fill="none" stroke="#fff8df" strokeWidth="2.5" strokeLinecap="round"/>
 <path d="M181 111l8 2m-8 8l8 2m30 19l12 1" stroke="#fff6d7" strokeWidth="1.5" opacity=".5"/>
</g>
<!-- large red present -->
<g>
 <path d="M65 101l114 2v66l-114-2z" fill="#6e1520" opacity=".22"/>
 <path d="M61 94l115 2v70l-115-2z" fill="url(#giftRuby)" stroke="#861626" strokeWidth="1.7"/>
 <path d="M105 95l21 1v69l-21-1z" fill="url(#giftRibbon)"/>
 <path d="M61 121l115 2" stroke="#7d1423" strokeWidth="1.2" opacity=".55"/>
 <path d="M68 103l29 1m-29 5l22 1m68 46l9 0" stroke="#ffb6a4" strokeWidth="1.7" opacity=".45" strokeLinecap="round"/>
 <path d="M56 85l124 3v15l-124-3z" fill="#b8192b" stroke="#781321" strokeWidth="1.5"/>
 <path d="M105 86l21 1v15l-21-1z" fill="url(#giftRibbon)"/>
 <path d="M115 87C82 84 78 62 92 57c10-4 19 9 24 27 7-22 26-33 36-21 10 12-9 26-37 24z" fill="url(#giftRedRibbon)" stroke="#b1813c" strokeWidth="1.7"/>
 <path d="M113 84C94 71 88 63 94 59m22 25c12-21 24-28 31-22" fill="none" stroke="#fff9e8" strokeWidth="3" strokeLinecap="round"/>
 <path d="M73 132h17m-17 7h12m-12 7h19" stroke="#ffb9a9" strokeWidth="1.8" opacity=".48" strokeLinecap="round"/>
 <path d="M146 132l13 13m0-13l-13 13" stroke="#ffd5bd" strokeWidth="1.4" opacity=".35"/>
</g>
<!-- foreground green gift -->
<g>
 <path d="M24 132l51 1v37l-51-1z" fill="url(#giftGreen)" stroke="#06442e" strokeWidth="1.5"/>
 <path d="M44 132l10 0v37l-10 0z" fill="url(#giftRibbon)"/>
 <path d="M20 124l59 1v11l-59-1z" fill="#075b3b" stroke="#03402d" strokeWidth="1.4"/>
 <path d="M44 124l10 0v11l-10 0z" fill="url(#giftRibbon)"/>
 <path d="M49 125C33 123 31 112 38 109c5-2 10 5 11 13 4-11 14-16 19-10 5 6-6 14-19 13z" fill="url(#giftGold)" stroke="#a8752a" strokeWidth="1.2"/>
 <path d="M48 123c-8-7-10-11-7-13m9 13c6-10 12-12 15-10" fill="none" stroke="#fff7dc" strokeWidth="1.8" strokeLinecap="round"/>
</g>
<!-- holly, stars and tiny lights -->
<g fill="#bd1e32"><circle cx="78" cy="35" r="4"/><circle cx="87" cy="39" r="4"/><circle cx="82" cy="47" r="4"/><circle cx="220" cy="28" r="3.5"/><circle cx="227" cy="32" r="3.5"/><circle cx="222" cy="39" r="3.5"/></g>
<g fill="#176a42"><path d="M82 43q-18-17-18 0 8 2 18 0 1 18 12 10 0-10-12-10zM222 35q-15-16-17-1 8 4 17 1 1 16 11 8 0-9-11-8z"/></g>
<g fill="url(#giftGold)"><path d="M147 9l5 11 12 1-9 8 3 12-11-6-10 6 3-12-9-8 12-1z"/><path d="M24 19l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z"/></g>
<g fill="#e6bd65"><circle cx="111" cy="26" r="2.5"/><circle cx="183" cy="32" r="2.5"/><circle cx="267" cy="75" r="2"/><circle cx="34" cy="75" r="2"/><circle cx="151" cy="58" r="2"/></g>
<path d="M16 174Q147 181 284 173" stroke="#d9bd84" strokeWidth="1.2" opacity=".55" fill="none"/>
</svg></div><span className="current-sector">{sector}</span></div></div>
  <div className="monthbar"><button onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()-1,1));setPage(1)}}>‹ <span>Mês Anterior</span></button><strong>▦　{month.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase())}</strong><div><button className="outlined" onClick={()=>{setMonth(new Date());setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));setPage(1)}}>Mês Atual</button><button onClick={()=>{setMonth(new Date(month.getFullYear(),month.getMonth()+1,1));setPage(1)}}>Próximo Mês ›</button></div></div>
  <div className="cards">
   <article role="button" tabIndex={0} aria-pressed={statusFilter==='Em andamento'} className={statusFilter==='Em andamento'?'selected':''} onClick={()=>{setStatusFilter(statusFilter==='Em andamento'?'':'Em andamento');setPage(1)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStatusFilter(statusFilter==='Em andamento'?'':'Em andamento');setPage(1)}}}><small>Em andamento</small><b className="blue">⌁</b><strong>{counts.doing}</strong><em>Datas em execução · clicar para filtrar</em></article>
   <article role="button" tabIndex={0} aria-pressed={statusFilter==='Atrasada'} className={'latecard'+(counts.late>0?' alert-pulse':'')+(statusFilter==='Atrasada'?' selected':'')} onClick={()=>{setStatusFilter(statusFilter==='Atrasada'?'':'Atrasada');setPage(1)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStatusFilter(statusFilter==='Atrasada'?'':'Atrasada');setPage(1)}}}><small>Atrasadas</small><b>◷</b><strong>{counts.late}</strong><em>OPs com data vencida · clicar para filtrar</em></article>
   <article role="button" tabIndex={0} aria-pressed={statusFilter==='Concluída'} className={statusFilter==='Concluída'?'selected':''} onClick={()=>{setStatusFilter(statusFilter==='Concluída'?'':'Concluída');setPage(1)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStatusFilter(statusFilter==='Concluída'?'':'Concluída');setPage(1)}}}><small>Concluídas</small><b className="green">✓</b><strong>{counts.done}</strong><em>Datas finalizadas · clicar para filtrar</em></article>
   <article role="button" tabIndex={0} aria-pressed={statusFilter==='Não iniciada'} className={statusFilter==='Não iniciada'?'selected':''} onClick={()=>{setStatusFilter(statusFilter==='Não iniciada'?'':'Não iniciada');setPage(1)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStatusFilter(statusFilter==='Não iniciada'?'':'Não iniciada');setPage(1)}}}><small>Não iniciadas</small><b>▱</b><strong>{counts.waiting}</strong><em>Aguardando apontamento · clicar para filtrar</em></article>
  </div>
  <section className="filters"><div className="filterhead"><b>☷　Filtros <span>{[parent,series,client,power,line,from,to,statusFilter].filter(Boolean).length}</span></b><button onClick={clear}>↶　Limpar filtros</button></div><div className="filtergrid">
   <label>OP-Pai<input value={parent} onChange={e=>setParent(e.target.value)} placeholder="Ex.: 43107"/></label><label>Série<input value={series} onChange={e=>setSeries(e.target.value)} placeholder="Número da série"/></label><label>Cliente<select value={client} onChange={e=>setClient(e.target.value)}><option value="">Todos os clientes</option>{clients.map(v=><option key={v}>{v}</option>)}</select></label><label>Potência PA<select value={power} onChange={e=>setPower(e.target.value)}><option value="">Todas</option>{powers.map(v=><option key={v}>{v}</option>)}</select></label><label>Linha Prod.<select value={line} onChange={e=>setLine(e.target.value)}><option value="">Todas</option>{lines.map(v=><option key={v}>{v}</option>)}</select></label><label>Programada de<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Situação<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">Todas</option><option>Em andamento</option><option>Atrasada</option><option>Concluída</option><option>Não iniciada</option></select></label></div></section>
  <div className="toolbar"><div><b>{filtered.length} programações diárias</b><small> · {month.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</small></div><div>Ordenar por <select value={sort} onChange={e=>setSort(e.target.value)}><option value="asc">Ordem da planilha</option><option value="desc">Data mais recente</option><option value="op">Número da OP</option></select></div></div>
  {error&&<div className="error">{error}</div>}{loading?<div className="empty">Carregando programação...</div>:<div className="tablewrap"><table><thead><tr><th>Data</th><th>OP</th><th>Cliente / referência</th><th>Linha / potência</th><th>Qtd. OP</th><th>Prog. dia</th>{stages.map(s=><th key={s}>{s}</th>)}<th>Situação Estamparia</th><th>Ações</th></tr></thead><tbody>{shown.map(r=>{const prog=Math.max(...stages.map(s=>stageFor(r,s)?.planned||0));return <tr key={r.key}><td className="date">{dateBR(r.date)}</td><td><b className="op">{r.parentOp}</b><small>OP: {r.op} · Série: {r.series||'—'}</small></td><td><b>{r.client}</b><small>{r.reference}</small></td><td><b>{r.line}</b><small>{r.power}</small></td><td className="center">{fmt(r.orderQty)}</td><td className="center plan">{fmt(prog)}</td>{stages.map(s=>{const st=stageFor(r,s),p=st?.planned||0,v=st?.reported||0,pct=p?Math.min(100,v/p*100):0;return <td key={s} className={"stagecell "+(v>0?"stagecell-pointed":"")}><b>{fmt(v)} / {fmt(p)}</b><div className="progress"><i style={{width:pct+'%'}}/></div></td>})}<td><span className={'pill '+stageStatus(r).toLowerCase().replaceAll(' ','-')}>{stageStatus(r)}</span></td><td><div className="row-actions"><button className="point" onClick={()=>openPoint(r)}>＋ Apontar</button><button className="edit-action" title="Editar apontamento" aria-label="Editar apontamento" disabled={!stages.some(stage=>(r.stages[stage]?.entries||[]).length)} onClick={()=>openEdit(r)}>✎</button></div></td></tr>})}{!shown.length&&<tr><td colSpan={8+stages.length} className="empty">Nenhuma programação encontrada com os filtros selecionados.</td></tr>}</tbody></table></div>}
  <div className="pagination"><span>Página {page} de {Math.max(1,Math.ceil(filtered.length/pageSize))}</span><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹</button><button disabled={page>=Math.ceil(filtered.length/pageSize)} onClick={()=>setPage(p=>p+1)}>›</button></div>
  </section></div></div>
  {settings&&<div className="backdrop" onClick={()=>setSettings(false)}><div className="dialog exportdialog" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSettings(false)}>×</button><h2>Adicionar planilhas</h2><p>Escolha qual programação deseja atualizar.</p><div className="export-actions">{restrictedAccess&&<label className="export-option" style={{cursor:'pointer'}}><span>▤</span><div><b>{importBusy==='FERRAGEM'?'Adicionando...':'Excel de Ferragem, Dobradeira e Plasma'}</b><small>Atualiza FERRAGEM SUPERIOR, FERRAGEM INFERIOR, DOBRA SUPERIOR e DOBRA INFERIOR (.xls ou .xlsx)</small></div><strong>＋</strong><input type="file" accept=".xls,.xlsx" disabled={!!importBusy} style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)void importWorkbook(f,'FERRAGEM');e.currentTarget.value=''}}/></label>}{!restrictedAccess&&<label className="export-option" style={{cursor:'pointer'}}><span>▦</span><div><b>{importBusy==='DEMAIS'?'Adicionando...':'Excel de Estamp. Tanque / Tampa — demais'}</b><small>Planilha exclusiva de Estamp. Tanque / Tampa para os demais setores (.xls ou .xlsx)</small></div><strong>＋</strong><input type="file" accept=".xls,.xlsx" disabled={!!importBusy} style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)void importWorkbook(f,'DEMAIS');e.currentTarget.value=''}}/></label>}</div></div></div>}
  {modal&&<div className="backdrop" onClick={()=>setModal(null)}><div className="dialog pointdialog production-dialog" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setModal(null)}>×</button><h2>{editTarget?'Editar apontamento':'Apontar produção'}</h2><p>OP {modal.parentOp} · {modal.op} · {dateBR(modal.date)}</p><label>Programação do dia<select value={modal.key} disabled><option value={modal.key}>{dateBR(modal.date)} · {fmt(modal.orderQty)} un. · séries {modal.series||'—'}</option></select></label><p className="scheduled-hint">▦　Produção programada para {dateBR(modal.date)}. O horário do registro será o de agora.</p>{editTarget&&<label>Apontamento para editar<select value={editTarget.id} onChange={e=>{const target=stages.flatMap(stage=>(stageFor(modal,stage)?.entries||[]).map(entry=>({id:entry.id,scheduleId:stageFor(modal,stage)?.id||0,stage,quantity:entry.quantity,operator:entry.operator||'',note:entry.note||''}))).find(item=>item.id===Number(e.target.value));if(target){setEditTarget(target);setActiveStage(target.stage);setAmounts({[target.stage]:String(target.quantity)});setOperator(target.operator);setNote(target.note)}}}>{stages.flatMap(stage=>(stageFor(modal,stage)?.entries||[]).map(entry=><option key={entry.id} value={entry.id}>{stage} · {fmt(entry.quantity)} peças · {entry.operator||'Sem operador'}</option>))}</select></label>}<div className="production-section-title">{editTarget?'Registro selecionado':'Selecione o que deseja apontar'}</div>{!editTarget&&<p className="production-help">{restrictedAccess?'Informe as quantidades das operações que deseja apontar. Ferragem Superior, Ferragem Inferior, Dobra Superior e Dobra Inferior possuem apontamentos independentes.':'Informe a quantidade somente nos subsetores produzidos. Cada quantidade tem seu próprio saldo.'} Campos vazios ou com zero não serão registrados.</p>}<div className="production-stage-list">{stages.filter(stage=>(stageFor(modal,stage)||restrictedAccess)&&(!editTarget||stage===editTarget.stage)).map(stage=>{const st=stageFor(modal,stage)||{id:0,planned:0,reported:0,entries:[]},pending=Math.max(0,st.planned-st.reported);return <div className="production-stage" key={stage}><div><b>{stage}</b><small>{fmt(st.reported)} produzido(s) · {fmt(pending)} pendente(s)</small></div><input type="number" min="0" max={pending||undefined} step="1" value={amounts[stage]||''} onChange={e=>setAmounts(a=>({...a,[stage]:e.target.value}))} placeholder="0"/></div>})}</div>{editTarget&&<p className="production-help">Editando um registro já salvo. A alteração substitui a quantidade, operador e observação desse apontamento.</p>}<div className="production-total"><span>{Object.values(amounts).filter(v=>Number(v)>0).length} {restrictedAccess?'operação(ões)':'subsetor(es)'} selecionado(s)</span><b>{fmt(Object.values(amounts).reduce((n,v)=>n+Math.max(0,Number(v)||0),0))} apontamento(s) de peças</b></div><p className="production-help">{restrictedAccess?'Cada apontamento de Ferragem Superior, Ferragem Inferior, Dobra Superior ou Dobra Inferior será salvo separadamente.':'Cada subsetor preenchido será salvo como um apontamento independente.'}</p><label className="production-note">Observação (opcional)<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Acrescente um detalhe sobre este registro..."/></label><div className="dialogactions"><button onClick={()=>setModal(null)}>Cancelar</button><button className="point" disabled={busy} onClick={save}>{busy?'Salvando...':editTarget?'Salvar edição':'Confirmar apontamento'}</button></div></div></div>}
 </main>
}
