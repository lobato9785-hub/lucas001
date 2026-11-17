'use client';
import { useState, FormEvent } from 'react';

export default function SectorLogin() {
  const [sector, setSector] = useState<'ferragem'|'laser'>('ferragem');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sector-auth', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({sector, password})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
      window.location.assign(sector === 'ferragem' ? '/ferragem' : '/laser');
    } catch (err: any) { setError(err.message || 'Falha ao validar o acesso.'); }
    finally { setBusy(false); }
  }

  return <main className="sector-login-page">
    <form className="sector-login-card" onSubmit={submit}>
      <div className="sector-login-brand">TAM</div>
      <h1>⌑　Controle de Produção</h1>
      <p>Acesse seu setor para realizar os apontamentos e acompanhar a produção.</p>
      <div className="sector-login-label">SETOR DE ACESSO</div>
      <div className="sector-choice-grid">
        <button type="button" className={sector==='ferragem'?'chosen':''} onClick={()=>{setSector('ferragem');setPassword('');setError('')}}>
          <span className="choice-dot"/> <span><b>Ferragem</b><small>Plasma e Dobradeira</small></span>
        </button>
        <button type="button" className={sector==='laser'?'chosen':''} onClick={()=>{setSector('laser');setPassword('');setError('')}}>
          <span className="choice-dot"/> <span><b>Laser</b><small>Demais setores</small></span>
        </button>
      </div>
      <label htmlFor="sector-password">♙　Senha do setor</label>
      <input id="sector-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Digite a senha" autoComplete="current-password" required/>
      {error&&<div className="sector-login-error" role="alert">{error}</div>}
      <button className="sector-submit" type="submit" disabled={busy||!password}>{busy?'Validando...':'Entrar no setor　 →'}</button>
      <small className="sector-login-foot">O apontamento será permitido exclusivamente no setor autenticado.</small>
    </form>
  </main>;
}
