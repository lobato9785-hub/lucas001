import './turnos.css';
import '../master-theme.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSectorRole, SECTOR_COOKIE } from '../../../lib/sector-auth';
import TurnosDashboard from './turnos-dashboard';

export const dynamic = 'force-dynamic';

export default function ProductivityShiftsPage() {
  if (getSectorRole(cookies().get(SECTOR_COOKIE)?.value) !== 'master') redirect('/');
  return <TurnosDashboard />;
}
