import { createHmac, createHash, timingSafeEqual } from 'crypto';

export const PLASMA_COOKIE = 'plasma_access';
export const PLASMA_SESSION_SECONDS = 60 * 60 * 12;

function signature(issuedAt: string) {
  const secret = process.env.PLASMA_SESSION_SECRET;
  if (!secret) throw new Error('PLASMA_SESSION_SECRET ausente');
  return createHmac('sha256', secret).update(issuedAt).digest('hex');
}

export function verifyPlasmaPassword(candidate: string) {
  const expected = process.env.PLASMA_ACCESS_PASSWORD;
  if (!expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function createPlasmaToken() {
  const issuedAt = String(Date.now());
  return issuedAt + '.' + signature(issuedAt);
}

export function isValidPlasmaToken(token?: string | null) {
  if (!token || !process.env.PLASMA_SESSION_SECRET) return false;
  const [issuedAt, suppliedSignature, extra] = token.split('.');
  if (!issuedAt || !suppliedSignature || extra !== undefined || !/^\d{10,}$/.test(issuedAt)) return false;
  const timestamp = Number(issuedAt);
  const age = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || age < -60_000 || age > PLASMA_SESSION_SECONDS * 1000) return false;
  const expected = signature(issuedAt);
  const a = Buffer.from(suppliedSignature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
