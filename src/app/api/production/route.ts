import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
export const dynamic = 'force-dynamic';
const allowed = ['CORTE LASER','RADIADOR','BORDEADEIRA','PRENSA','PLASMA','DOBRADEIRA'];
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  return neon(process.env.DATABASE_URL);
};
export async function GET(req: NextRequest) {
  try {
    const sector = (req.nextUrl.searchParams.get('sector') || 'CORTE LASER').toUpperCase();
    if (!allowed.includes(sector)) return NextResponse.json({ error: 'Setor inválido' }, { status: 400 });
    const sql = db();
    const rows = await sql.query(`
      SELECT ps.id, ps.process_type, ps.operation_type, ps.op_number, ps.parent_op,
        ps.scheduled_date, ps.client_name, ps.product_reference, ps.product_description,
        ps.production_line, ps.power_pa, ps.order_quantity, ps.planned_quantity,
        ps.series_start, ps.series_end,
        COALESCE(SUM(pe.quantity),0)::int AS reported_quantity,
        COALESCE(json_agg(json_build_object('id',pe.id,'quantity',pe.quantity,'operator',pe.operator_name,'note',pe.note,'at',pe.created_at))
          FILTER (WHERE pe.id IS NOT NULL), '[]'::json) AS entries
      FROM process_schedule ps
      LEFT JOIN process_entries pe ON pe.schedule_id = ps.id
      WHERE ps.process_type = $1
      GROUP BY ps.id
      ORDER BY ps.scheduled_date, ps.op_number
      LIMIT 10000
    `, [sector]);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Falha ao consultar o banco de produção' }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length || entries.length > 3 || entries.some((e:any) =>
      !Number.isSafeInteger(Number(e.scheduleId)) || Number(e.scheduleId) < 1 ||
      !Number.isSafeInteger(Number(e.quantity)) || Number(e.quantity) < 1
    )) return NextResponse.json({ error: 'Informe quantidades válidas para até três etapas.' }, { status: 400 });
    const sql = db();
    const saved = [];
    for (const entry of entries) {
      const rows = await sql.query(
        'INSERT INTO process_entries (schedule_id, quantity, operator_name, note, idempotency_key) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [Number(entry.scheduleId), Number(entry.quantity), String(entry.operator || '').slice(0,120), String(entry.note || '').slice(0,500), randomUUID()]
      );
      saved.push(rows[0]);
    }
    return NextResponse.json({ success: true, saved: saved.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível salvar o apontamento.' }, { status: 500 });
  }
}
