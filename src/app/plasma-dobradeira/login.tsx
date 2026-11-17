'use client';
import { FormEvent, useState } from 'react';

export default function PlasmaLogin() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/plasma-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
      window.location.replace('/plasma-dobradeira');
    } catch (err: any) {
      setError(err.message || 'Falha ao validar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="plasma-login-page">
      <form className="plasma-login-card" onSubmit={submit}>
        <div className="plasma-login-mark">E</div>
        <div className="plasma-login-eyebrow">ESTAMPARIA · CHÃO DE FÁBRICA</div>
        <h1>PLASMA + DOBRADEIRA</h1>
        <p>Área de produção protegida. Digite a senha para continuar.</p>
        <label htmlFor="plasma-password">Senha de acesso</label>
        <input
          id="plasma-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Digite a senha"
          autoComplete="current-password"
          required
          autoFocus
        />
        {error && <div className="plasma-login-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Validando...' : 'Entrar no setor'}
        </button>
        <a href="/">Voltar ao acesso principal</a>
      </form>
    </main>
  );
}
