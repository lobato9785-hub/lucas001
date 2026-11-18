import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { getSectorRole, SECTOR_COOKIE } from '../../../../lib/sector-auth';
export const dynamic = 'force-dynamic';

const sectors: Record<string,string[]> = {
  'CORTE LASER':['CORPO','FUNDO','TAMPA'],
  'RADIADOR':['CORTE','DOBRA','ESTAMPAGEM'],
  'BORDEADEIRA':['BORDA','ESTAMPAGEM','NÚMERO DE SÉRIE'],
  'PRENSA':['PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE','CORPO NÚMERO DE SÉRIE'],
  'PLASMA':['FERRAGEM','FERRAGEM INFERIOR','FERRAGEM SUPERIOR'],
  'DOBRADEIRA':['DOBRA','DOBRA SUPERIOR','DOBRA INFERIOR']
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileType = String(body.fileType || '');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const role = getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value);
    if (fileType === 'FERRAGEM' && role !== 'ferragem') return NextResponse.json({ error: 'Acesso Ferragem necessário para importar esta planilha.' }, { status: 401 });
    if (fileType === 'DEMAIS' && role !== 'laser') return NextResponse.json({ error: 'Acesso Laser necessário para importar esta planilha.' }, { status: 401 });
    if (!['FERRAGEM','DEMAIS'].includes(fileType) || !rows.length || rows.length > 10000)
      return NextResponse.json({ error: 'Envie uma planilha válida com até 10.000 linhas.' }, { status: 400 });

    for (const row of rows) {
      const process = String(row.process_type || '').toUpperCase();
      const stage = String(row.operation_type || '').toUpperCase();
      const ferragem = (process === 'PLASMA' && ['FERRAGEM INFERIOR','FERRAGEM SUPERIOR'].includes(stage)) || (process === 'DOBRADEIRA' && ['DOBRA','DOBRA SUPERIOR','DOBRA INFERIOR'].includes(stage));
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
      WITH incoming AS MATERIALIZED (
        SELECT *
        FROM json_to_recordset($1::json) AS x(
          process_type text, operation_type text, op_number text, parent_op text,
          scheduled_date date, series_start text, series_end text, client_name text,
          client_code text, product_reference text, product_description text,
          production_line text, power_pa text, order_quantity integer,
          planned_quantity integer, source_status text
        )
      ),
      legacy_dobra AS (
        UPDATE process_schedule old
        SET operation_type = 'DOBRA INFERIOR', updated_at = NOW()
        WHERE old.process_type = 'DOBRADEIRA'
          AND old.operation_type = 'DOBRA'
          AND EXISTS (
            SELECT 1 FROM incoming i
            WHERE i.process_type = 'DOBRADEIRA'
              AND i.operation_type = 'DOBRA INFERIOR'
              AND i.op_number = old.op_number
              AND i.scheduled_date = old.scheduled_date
              AND COALESCE(i.series_start,'') = COALESCE(old.series_start,'')
              AND COALESCE(i.series_end,'') = COALESCE(old.series_end,'')
          )
        RETURNING old.id
      ),
      upserted AS (
        INSERT INTO process_schedule (
          process_type, operation_type, op_number, parent_op, scheduled_date,
          series_start, series_end, client_name, client_code, product_reference,
          product_description, production_line, power_pa, order_quantity,
          planned_quantity, source_status, updated_at
        )
        SELECT
          process_type, operation_type, op_number, parent_op, scheduled_date,
          series_start, series_end, client_name, client_code, product_reference,
          product_description, production_line, power_pa, order_quantity,
          planned_quantity, '__ACTIVE__', NOW()
        FROM incoming
        CROSS JOIN (SELECT COUNT(*) FROM legacy_dobra) migration
        ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
        DO UPDATE SET
          parent_op = EXCLUDED.parent_op, client_name = EXCLUDED.client_name,
          client_code = EXCLUDED.client_code, product_reference = EXCLUDED.product_reference,
          product_description = EXCLUDED.product_description, production_line = EXCLUDED.production_line,
          power_pa = EXCLUDED.power_pa, order_quantity = EXCLUDED.order_quantity,
          planned_quantity = EXCLUDED.planned_quantity, source_status = '__ACTIVE__',
          updated_at = NOW()
        RETURNING id, process_type, operation_type, op_number, scheduled_date, series_start, series_end
      ),
      moved_entries AS (
        UPDATE process_entries pe
        SET schedule_id = target.id
        FROM process_schedule old
        CROSS JOIN LATERAL (
          SELECT u.id
          FROM upserted u
          WHERE u.process_type = old.process_type
            AND u.operation_type = old.operation_type
            AND u.op_number = old.op_number
            AND COALESCE(u.series_start,'') = COALESCE(old.series_start,'')
            AND COALESCE(u.series_end,'') = COALESCE(old.series_end,'')
          ORDER BY (u.scheduled_date = old.scheduled_date) DESC, u.scheduled_date ASC, u.id
          LIMIT 1
        ) target
        WHERE pe.schedule_id = old.id
          AND old.id <> target.id
          AND EXISTS (
            SELECT 1 FROM incoming scope
            WHERE scope.process_type = old.process_type
              AND scope.operation_type = old.operation_type
          )
        RETURNING pe.id
      ),
      archived AS (
        UPDATE process_schedule old
        SET source_status = '__ARCHIVED__', updated_at = NOW()
        WHERE (
          EXISTS (
            SELECT 1 FROM incoming scope
            WHERE scope.process_type = old.process_type
              AND scope.operation_type = old.operation_type
          )
          OR (
            old.process_type = 'PLASMA'
            AND old.operation_type = 'FERRAGEM'
            AND EXISTS (
              SELECT 1 FROM incoming scope
              WHERE scope.process_type = 'PLASMA'
                AND scope.operation_type IN ('FERRAGEM INFERIOR','FERRAGEM SUPERIOR')
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM incoming i
          WHERE i.process_type = old.process_type
            AND i.operation_type = old.operation_type
            AND i.op_number = old.op_number
            AND i.scheduled_date = old.scheduled_date
            AND COALESCE(i.series_start,'') = COALESCE(old.series_start,'')
            AND COALESCE(i.series_end,'') = COALESCE(old.series_end,'')
        )
        RETURNING old.id
      )
      SELECT
        (SELECT COUNT(*)::int FROM upserted) AS imported,
        (SELECT COUNT(*)::int FROM moved_entries) AS moved_entries,
        (SELECT COUNT(*)::int FROM archived) AS archived
    `, [JSON.stringify(rows)]);
    return NextResponse.json({ success: true, imported: Number(result[0]?.imported || 0), movedEntries: Number(result[0]?.moved_entries || 0), archived: Number(result[0]?.archived || 0), ignored: 0 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Não foi possível adicionar a planilha ao banco de produção.' }, { status: 500 });
  }
}
