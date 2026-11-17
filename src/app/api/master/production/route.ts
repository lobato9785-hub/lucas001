import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { getSectorRole, SECTOR_COOKIE } from '../../../../lib/sector-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value) !== 'master') {
      return NextResponse.json({ error: 'Acesso MASTER necessário.' }, { status: 401 });
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql.query(`
      SELECT ps.id, ps.process_type, ps.operation_type, ps.op_number, ps.parent_op,
        ps.scheduled_date, ps.client_name, ps.product_reference, ps.product_description,
        ps.production_line, ps.power_pa, ps.order_quantity, ps.planned_quantity,
        ps.series_start, ps.series_end,
        COALESCE(SUM(pe.quantity),0)::int AS reported_quantity,
        COALESCE(json_agg(json_build_object(
          'id',pe.id,'quantity',pe.quantity,'operator',pe.operator_name,
          'note',pe.note,'at',pe.created_at
        )) FILTER (WHERE pe.id IS NOT NULL), '[]'::json) AS entries
      FROM process_schedule ps
      LEFT JOIN process_entries pe ON pe.schedule_id = ps.id
      WHERE COALESCE(ps.source_status,'') <> '__ARCHIVED__'
      GROUP BY ps.id
      ORDER BY ps.scheduled_date, ps.process_type, ps.operation_type, ps.id
      LIMIT 20000
    `);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Falha ao consultar a produção para o MASTER.' }, { status: 500 });
  }
}
