import { NextRequest, NextResponse } from 'next/server';
import { createSectorToken, SECTOR_COOKIE, verifySectorPassword, SectorRole } from '../../../lib/sector-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const role = body.sector as SectorRole;
    const password = typeof body.password === 'string' ? body.password : '';
    if (role !== 'ferragem' && role !== 'laser') return NextResponse.json({error:'Selecione um setor válido.'},{status:400});
    if (!process.env.SECTOR_SESSION_SECRET ||
        !(role === 'ferragem' ? process.env.FERRAGEM_ACCESS_PASSWORD : process.env.LASER_ACCESS_PASSWORD)) {
      return NextResponse.json({error:'Acesso ainda não configurado. Avise o administrador.'},{status:503});
    }
    if (!verifySectorPassword(role,password)) return NextResponse.json({error:'Senha incorreta.'},{status:401});
    const response=NextResponse.json({success:true});
    response.cookies.set(SECTOR_COOKIE,createSectorToken(role),{
      httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:12*60*60
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({error:'Não foi possível validar o acesso.'},{status:500});
  }
}
