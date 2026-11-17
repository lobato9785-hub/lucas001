import { NextRequest, NextResponse } from 'next/server';
import { createPlasmaToken, PLASMA_COOKIE, PLASMA_SESSION_SECONDS, verifyPlasmaPassword } from '@/lib/plasma-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.PLASMA_ACCESS_PASSWORD || !process.env.PLASMA_SESSION_SECRET) {
      return NextResponse.json({ error: 'Acesso protegido ainda não configurado.' }, { status: 503 });
    }
    const body = await req.json();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyPlasmaPassword(password)) {
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    }
    const response = NextResponse.json({ success: true });
    response.cookies.set(PLASMA_COOKIE, createPlasmaToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: PLASMA_SESSION_SECONDS
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível validar o acesso.' }, { status: 500 });
  }
}
