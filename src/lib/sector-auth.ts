import { createHmac, createHash, timingSafeEqual } from 'crypto';

export type SectorRole = 'ferragem' | 'laser';
export const SECTOR_COOKIE = 'estamparia_sector';

function signature(payload: string) {
  const secret = process.env.SECTOR_SESSION_SECRET;
  if (!secret) throw new Error('SECTOR_SESSION_SECRET ausente');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifySectorPassword(role: SectorRole, candidate: string) {
  const expected = role === 'ferragem'
    ? process.env.FERRAGEM_ACCESS_PASSWORD
    : process.env.LASER_ACCESS_PASSWORD;
  if (!expected) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createSectorToken(role: SectorRole) {
  const issuedAt = String(Date.now());
  const payload = role + ':' + issuedAt;
  return payload + '.' + signature(payload);
}

export function getSectorRole(token?: string | null): SectorRole | null {
  if (!token || !process.env.SECTOR_SESSION_SECRET) return null;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra !== undefined) return null;
  const [role, issuedAt] = payload.split(':');
  if ((role !== 'ferragem' && role !== 'laser') || !/^\\d{10,}$/.test(issuedAt || '')) return null;
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 12 * 60 * 60 * 1000) return null;
  const a = Buffer.from(supplied, 'hex');
  const b = Buffer.from(signature(payload), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? role : null;
}
