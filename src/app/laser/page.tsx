import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Dashboard from '../dashboard';
import { getSectorRole, SECTOR_COOKIE } from '../../lib/sector-auth';

export const dynamic = 'force-dynamic';

export default function LaserPage() {
  if (getSectorRole(cookies().get(SECTOR_COOKIE)?.value) !== 'laser') redirect('/');
  return <Dashboard initialSector="CORTE LASER" />;
}
