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
    // Busca programação e apontamentos separadamente para evitar que o
    // agrupamento do JOIN esconda lançamentos em alguns setores.
    const schedules = await sql.query(`
      SELECT ps.id, ps.process_type, ps.operation_type, ps.op_number, ps.parent_op,
        ps.scheduled_date, ps.client_name, ps.product_reference, ps.product_description,
        ps.production_line, ps.power_pa, ps.order_quantity, ps.planned_quantity,
        ps.series_start, ps.series_end
      FROM process_schedule ps
      WHERE COALESCE(ps.source_status,'') <> '__ARCHIVED__'
      ORDER BY ps.scheduled_date, ps.process_type, ps.operation_type, ps.id
      LIMIT 20000
    `);
    const entryRows = await sql.query(`
      SELECT pe.id, pe.schedule_id, pe.quantity, pe.operator_name, pe.note, pe.created_at
      FROM process_entries pe
      INNER JOIN process_schedule ps ON ps.id = pe.schedule_id
      WHERE COALESCE(ps.source_status,'') <> '__ARCHIVED__'
      ORDER BY pe.created_at, pe.id
    `);
    const entriesBySchedule = new Map<number, any[]>();
    for (const entry of entryRows as any[]) {
      const key = Number(entry.schedule_id);
      const list = entriesBySchedule.get(key) || [];
      list.push({
        id: Number(entry.id), quantity: Number(entry.quantity || 0),
        operator: entry.operator_name || '', note: entry.note || '',
        at: entry.created_at
      });
      entriesBySchedule.set(key, list);
    }
    const rows = (schedules as any[]).map((schedule: any) => {
      const entries = entriesBySchedule.get(Number(schedule.id)) || [];
      const reported = entries.reduce((sum: number, entry: any) => sum + Number(entry.quantity || 0), 0);
      return { ...schedule, reported_quantity: reported, entries };
    });
    const sectorDiagnostics = rows.reduce((acc: Record<string, { schedules: number; reported: number }>, row: any) => {
      const key = String(row.process_type || 'SEM_SETOR');
      if (!acc[key]) acc[key] = { schedules: 0, reported: 0 };
      acc[key].schedules += 1;
      acc[key].reported += Number(row.reported_quantity || 0);
      return acc;
    }, {});
    let databaseHost = 'indisponivel';
    try { databaseHost = new URL(process.env.DATABASE_URL!).hostname; } catch {}
    console.info('[MASTER_PRODUCTION_DIAGNOSTIC]', JSON.stringify({
      databaseHost, rowCount: rows.length, sectors: sectorDiagnostics,
      sampleOp43536: rows.filter((row: any) => String(row.op_number) === '43536')
        .map((row: any) => ({ process: row.process_type, stage: row.operation_type, date: String(row.scheduled_date).slice(0,10), planned: Number(row.planned_quantity || 0), reported: Number(row.reported_quantity || 0) }))
    }));
    return NextResponse.json({ rows, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Surrogate-Control': 'no-store' } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Falha ao consultar a produção para o MASTER.' }, { status: 500 });
  }
}
