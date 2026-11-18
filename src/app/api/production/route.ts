import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSectorRole, SECTOR_COOKIE } from '../../../lib/sector-auth';
export const dynamic = 'force-dynamic';
const allowed = ['CORTE LASER','RADIADOR','BORDEADEIRA','PRENSA','PLASMA','DOBRADEIRA','PLASMA + DOBRADEIRA'];
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  return neon(process.env.DATABASE_URL);
};
export async function GET(req: NextRequest) {
  try {
    const sector = (req.nextUrl.searchParams.get('sector') || 'CORTE LASER').toUpperCase();
    if (!allowed.includes(sector)) return NextResponse.json({ error: 'Setor inválido' }, { status: 400 });
    const protectedSector = ['PLASMA','DOBRADEIRA','PLASMA + DOBRADEIRA'].includes(sector);
    const role = getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value);
    if (protectedSector && role !== 'ferragem') return NextResponse.json({ error: 'Acesso Ferragem necessário.' }, { status: 401 });
    if (!protectedSector && role !== 'laser') return NextResponse.json({ error: 'Acesso Laser necessário.' }, { status: 401 });
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
      WHERE ${sector === 'PLASMA + DOBRADEIRA' ? "ps.process_type IN ('PLASMA','DOBRADEIRA')" : "ps.process_type = $1"} AND COALESCE(ps.source_status,'') <> '__ARCHIVED__'
      GROUP BY ps.id
      ORDER BY ps.scheduled_date, ps.id
      LIMIT 10000
    `, sector === 'PLASMA + DOBRADEIRA' ? [] : [sector]);
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
    if (!entries.length || entries.length > 4 || entries.some((e:any) =>
      !Number.isSafeInteger(Number(e.scheduleId)) || Number(e.scheduleId) < 1 ||
      !Number.isSafeInteger(Number(e.quantity)) || Number(e.quantity) < 1
    )) return NextResponse.json({ error: 'Informe quantidades válidas para até quatro etapas.' }, { status: 400 });
    const sql = db();
    const role = getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value);
    for (const entry of entries) {
      const schedule = await sql.query('SELECT process_type FROM process_schedule WHERE id = $1 LIMIT 1', [Number(entry.scheduleId)]);
      if (schedule[0] && ['PLASMA','DOBRADEIRA'].includes(String(schedule[0].process_type)) && role !== 'ferragem') {
        return NextResponse.json({ error: 'Acesso Ferragem necessário. Entre pelo acesso Ferragem.' }, { status: 401 });
      }
    }
    const saved = [];
    for (const entry of entries) {
      const scheduleId = Number(entry.scheduleId);
      const quantity = Number(entry.quantity);
      const operator = String(entry.operator || '').slice(0,120);
      const note = String(entry.note || '').slice(0,500);
      // Lock the schedule row and calculate the already reported quantity in
      // the same statement, so simultaneous requests cannot exceed the day plan.
      const rows = await sql.query(`
        WITH target AS MATERIALIZED (
          SELECT id, planned_quantity
          FROM process_schedule
          WHERE id = $1 AND COALESCE(source_status,'') <> '__ARCHIVED__'
          FOR UPDATE
        ),
        current_total AS (
          SELECT COALESCE(SUM(pe.quantity),0)::int AS reported
          FROM process_entries pe JOIN target t ON t.id = pe.schedule_id
        ),
        inserted AS (
          INSERT INTO process_entries (schedule_id, quantity, operator_name, note, idempotency_key)
          SELECT t.id, $2, $3, $4, $5
          FROM target t CROSS JOIN current_total c
          WHERE $2 <= GREATEST(0, t.planned_quantity - c.reported)
          RETURNING id
        )
        SELECT id FROM inserted
      `, [scheduleId, quantity, operator, note, randomUUID()]);
      if (!rows.length) {
        return NextResponse.json({ error: 'Quantidade acima do programado para este dia. Disponível: consulte o saldo pendente da etapa.' }, { status: 400 });
      }
      saved.push(rows[0]);
    }
    return NextResponse.json({ success: true, saved: saved.length });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível salvar o apontamento.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const entryId = Number(body.entryId);
    const quantity = Number(body.quantity);
    if (!Number.isSafeInteger(entryId) || entryId < 1 || !Number.isSafeInteger(quantity) || quantity < 1) {
      return NextResponse.json({ error: 'Informe uma quantidade válida para editar.' }, { status: 400 });
    }
    const sql = db();
    const role = getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value);
    const found = await sql.query(
      'SELECT pe.id, ps.process_type FROM process_entries pe JOIN process_schedule ps ON ps.id = pe.schedule_id WHERE pe.id = $1 LIMIT 1',
      [entryId]
    );
    if (!found.length) return NextResponse.json({ error: 'Apontamento não encontrado.' }, { status: 404 });
    const protectedSector = ['PLASMA','DOBRADEIRA','PLASMA + DOBRADEIRA'].includes(String(found[0].process_type));
    if ((protectedSector && role !== 'ferragem') || (!protectedSector && role !== 'laser')) {
      return NextResponse.json({ error: protectedSector ? 'Acesso Ferragem necessário.' : 'Acesso Laser necessário.' }, { status: 401 });
    }
    const updated = await sql.query(`
      WITH target AS MATERIALIZED (
        SELECT ps.id AS schedule_id, ps.planned_quantity
        FROM process_entries pe
        JOIN process_schedule ps ON ps.id = pe.schedule_id
        WHERE pe.id = $4 AND COALESCE(ps.source_status,'') <> '__ARCHIVED__'
        FOR UPDATE OF ps
      ),
      current_total AS (
        SELECT COALESCE(SUM(pe.quantity),0)::int AS reported
        FROM process_entries pe JOIN target t ON t.schedule_id = pe.schedule_id
        WHERE pe.id <> $4
      ),
      changed AS (
        UPDATE process_entries pe
        SET quantity = $1, operator_name = $2, note = $3
        FROM target t CROSS JOIN current_total c
        WHERE pe.id = $4 AND $1 <= GREATEST(0, t.planned_quantity - c.reported)
        RETURNING pe.id
      )
      SELECT id FROM changed
    `, [quantity, String(body.operator || '').slice(0,120), String(body.note || '').slice(0,500), entryId]);
    if (!updated.length) return NextResponse.json({ error: 'A edição ultrapassa a quantidade programada para este dia.' }, { status: 400 });
    return NextResponse.json({ success: true, updated: 1 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível editar o apontamento.' }, { status: 500 });
  }
}
