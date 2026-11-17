import { cookies } from 'next/headers';
import Home from '../page';
import PlasmaLogin from './login';
import { isValidPlasmaToken, PLASMA_COOKIE } from '../../lib/plasma-auth';

export const dynamic = 'force-dynamic';

export default function PlasmaDobradeiraPage() {
  const token = cookies().get(PLASMA_COOKIE)?.value;
  if (!isValidPlasmaToken(token)) return <PlasmaLogin />;
  return <Home initialSector="PLASMA + DOBRADEIRA" restrictedAccess />;
}
