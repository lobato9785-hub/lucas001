import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const sectors: Record<string,string[]> = {
  'CORTE LASER':['CORPO','FUNDO','TAMPA'],
  'RADIADOR':['CORTE','DOBRA','ESTAMPAGEM'],
  'BORDEADEIRA':['BORDA','ESTAMPAGEM','NÚMERO DE SÉRIE'],
  'PRENSA':['PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE'],
  'PLASMA':['FERRAGEM','FERRAGEM INFERIOR','FERRAGEM SUPERIOR'],
  'DOBRADEIRA':['DOBRA']
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileType = String(body.fileType || '');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!['FERRAGEM','DEMAIS'].includes(fileType) || !rows.length || rows.length > 10000)
      return NextResponse.json({ error: 'Envie uma planilha válida com até 10.000 linhas.' }, { status: 400 });

    for (const row of rows) {
      const process = String(row.process_type || '').toUpperCase();
      const stage = String(row.operation_type || '').toUpperCase();
      const ferragem = process === 'PLASMA' && stage === 'FERRAGEM';
      if (!(sectors[process] || []).includes(stage) ||
          !String(row.op_number || '').trim() ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(row.scheduled_date || '')) ||
          (fileType === 'FERRAGEM' && !ferragem) ||
          (fileType === 'DEMAIS' && ferragem)) {
        return NextResponse.json({ error: 'A planilha contém linhas incompatíveis com a opção escolhida, ou dados inválidos.' }, { status: 400 });
      }
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql.query(`
      INSERT INTO process_schedule (
        process_type, operation_type, op_number, parent_op, scheduled_date,
        series_start, series_end, client_name, client_code, product_reference,
        product_description, production_line, power_pa, order_quantity,
        planned_quantity, source_status, updated_at
      )
      SELECT
        x.process_type, x.operation_type, x.op_number, x.parent_op, x.scheduled_date,
        x.series_start, x.series_end, x.client_name, x.client_code, x.product_reference,
        x.product_description, x.production_line, x.power_pa, x.order_quantity,
        x.planned_quantity, x.source_status, NOW()
      FROM json_to_recordset($1::json) AS x(
        process_type text, operation_type text, op_number text, parent_op text,
        scheduled_date date, series_start text, series_end text, client_name text,
        client_code text, product_reference text, product_description text,
        production_line text, power_pa text, order_quantity integer,
        planned_quantity integer, source_status text
      )
      ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
      DO UPDATE SET
        parent_op = EXCLUDED.parent_op, client_name = EXCLUDED.client_name,
        client_code = EXCLUDED.client_code, product_reference = EXCLUDED.product_reference,
        product_description = EXCLUDED.product_description, production_line = EXCLUDED.production_line,
        power_pa = EXCLUDED.power_pa, order_quantity = EXCLUDED.order_quantity,
        planned_quantity = EXCLUDED.planned_quantity, source_status = EXCLUDED.source_status,
        updated_at = NOW()
      RETURNING id
    `, [JSON.stringify(rows)]);
    return NextResponse.json({ success: true, imported: result.length, ignored: 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível adicionar a planilha ao banco de produção.' }, { status: 500 });
  }
}
