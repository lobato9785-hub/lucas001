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
    const allowedStageProcesses:Record<string,string> = {
      'CORTE':'RADIADOR','DOBRA':'RADIADOR','ESTAMPAGEM':'RADIADOR','RADIADOR SOLDADO':'RADIADOR',
      'BORDA':'BORDEADEIRA','ESTAMPAGEM':'BORDEADEIRA','NÚMERO DE SÉRIE':'BORDEADEIRA',
      'FERRAGEM SUPERIOR':'PLASMA','FERRAGEM INFERIOR':'PLASMA',
      'DOBRA SUPERIOR':'DOBRADEIRA','DOBRA INFERIOR':'DOBRADEIRA',
      'PARA RAIO':'PRENSA','SUPORTE DE PLACA':'PRENSA','SUPORTE DE POSTE':'PRENSA','CORPO NÚMERO DE SÉRIE':'PRENSA'
    };
    const invalidEntry = entries.find((e:any) => {
      const scheduleId = Number(e.scheduleId);
      const hasSchedule = Number.isSafeInteger(scheduleId) && scheduleId > 0;
      const seed = e.createSchedule || {};
      const stage = String(seed.operationType || '').trim().toUpperCase();
      const processType = String(seed.processType || '').trim().toUpperCase();
      const canResolve = allowedStageProcesses[stage] === processType &&
        String(seed.opNumber || '').trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(seed.scheduledDate || ''));
      const quantity = Number(e.quantity);
      return (!hasSchedule && !canResolve) || !Number.isSafeInteger(quantity) || quantity < 1;
    });
    if (!entries.length || entries.length > 4 || invalidEntry) {
      return NextResponse.json({
        error: invalidEntry
          ? 'Uma das etapas está sem programação válida ou possui quantidade inválida. Confira os campos e tente novamente.'
          : 'Informe quantidades válidas para até quatro etapas.'
      }, { status: 400 });
    }
    const sql = db();
    const role = getSectorRole(req.cookies.get(SECTOR_COOKIE)?.value);
    for (const entry of entries) {
      const existingScheduleId = Number(entry.scheduleId)||0;
      if (!existingScheduleId) continue;
      const schedule = await sql.query('SELECT process_type FROM process_schedule WHERE id = $1 LIMIT 1', [existingScheduleId]);
      if (schedule[0] && ['PLASMA','DOBRADEIRA'].includes(String(schedule[0].process_type)) && role !== 'ferragem') {
        return NextResponse.json({ error: 'Acesso Ferragem necessário. Entre pelo acesso Ferragem.' }, { status: 401 });
      }
    }
    const saved = [];
    for (const entry of entries) {
      let scheduleId = Number(entry.scheduleId)||0;
      const quantity = Number(entry.quantity);
      if (!scheduleId && entry.createSchedule) {
        const seed=entry.createSchedule;
        const stage=String(seed.operationType||'').trim().toUpperCase();
        const processType=String(seed.processType||'').trim().toUpperCase();
        const found=await sql.query(
          `SELECT id FROM process_schedule
           WHERE process_type=$1 AND operation_type=$2 AND op_number=$3 AND scheduled_date=$4
             AND COALESCE(series_start,'')=COALESCE($5,'')
             AND COALESCE(series_end,'')=COALESCE($6,'')
             AND COALESCE(source_status,'') <> '__ARCHIVED__'
           ORDER BY id LIMIT 1`,
          [processType,stage,String(seed.opNumber),String(seed.scheduledDate),String(seed.seriesStart||''),String(seed.seriesEnd||'')]
        );
        if(found.length) scheduleId=Number(found[0].id);
      }
      if (!scheduleId && ['FERRAGEM SUPERIOR','FERRAGEM INFERIOR','DOBRA SUPERIOR','DOBRA INFERIOR'].includes(String(entry.createSchedule?.operationType||'').trim().toUpperCase())) {
        if (role !== 'ferragem') return NextResponse.json({ error: 'Acesso Ferragem necessário.' }, { status: 401 });
        const seed=entry.createSchedule;
        const stage=String(seed.operationType).trim().toUpperCase();
        const processType=stage.startsWith('FERRAGEM')?'PLASMA':'DOBRADEIRA';
        const created=await sql.query(`
          INSERT INTO process_schedule (
            process_type, operation_type, op_number, parent_op, scheduled_date,
            series_start, series_end, client_name, client_code, product_reference,
            product_description, production_line, power_pa, order_quantity,
            planned_quantity, source_status, updated_at
          )
          SELECT
            $1, $2, sibling.op_number, sibling.parent_op, sibling.scheduled_date,
            sibling.series_start, sibling.series_end, sibling.client_name, sibling.client_code, sibling.product_reference,
            sibling.product_description, sibling.production_line, sibling.power_pa, sibling.order_quantity,
            sibling.planned_quantity, '__ACTIVE__', NOW()
          FROM process_schedule sibling
          WHERE sibling.process_type IN ('PLASMA','DOBRADEIRA')
            AND sibling.op_number=$3 AND sibling.scheduled_date=$4
            AND COALESCE(sibling.series_start,'')=COALESCE($5,'')
            AND COALESCE(sibling.series_end,'')=COALESCE($6,'')
            AND sibling.operation_type <> $2
            AND COALESCE(sibling.source_status,'') <> '__ARCHIVED__'
          ORDER BY (sibling.process_type=$1) DESC, sibling.id
          LIMIT 1
          ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
          DO UPDATE SET source_status='__ACTIVE__', planned_quantity=EXCLUDED.planned_quantity, updated_at=NOW()
          RETURNING id
        `,[processType,stage,String(seed.opNumber),String(seed.scheduledDate),String(seed.seriesStart||''),String(seed.seriesEnd||'')]);
        if(!created.length) return NextResponse.json({ error: 'Não encontrei a programação de Ferragem desta OP e deste dia para criar a etapa.' }, { status: 400 });
        scheduleId=Number(created[0].id);
      }
      if (!scheduleId && ['PARA RAIO','SUPORTE DE PLACA','SUPORTE DE POSTE','CORPO NÚMERO DE SÉRIE'].includes(String(entry.createSchedule?.operationType||'').trim().toUpperCase())) {
        if (role !== 'laser') return NextResponse.json({ error: 'Acesso Prensa necessário.' }, { status: 401 });
        const seed=entry.createSchedule;
        const stage=String(seed.operationType).trim().toUpperCase();
        const created=await sql.query(`
          INSERT INTO process_schedule (
            process_type, operation_type, op_number, parent_op, scheduled_date,
            series_start, series_end, client_name, client_code, product_reference,
            product_description, production_line, power_pa, order_quantity,
            planned_quantity, source_status, updated_at
          )
          SELECT
            'PRENSA', $1, sibling.op_number, sibling.parent_op, sibling.scheduled_date,
            sibling.series_start, sibling.series_end, sibling.client_name, sibling.client_code, sibling.product_reference,
            sibling.product_description, sibling.production_line, sibling.power_pa, sibling.order_quantity,
            sibling.planned_quantity, '__ACTIVE__', NOW()
          FROM process_schedule sibling
          WHERE sibling.process_type='PRENSA'
            AND sibling.op_number=$2 AND sibling.scheduled_date=$3
            AND COALESCE(sibling.series_start,'')=COALESCE($4,'')
            AND COALESCE(sibling.series_end,'')=COALESCE($5,'')
            AND sibling.operation_type <> $1
            AND COALESCE(sibling.source_status,'') <> '__ARCHIVED__'
          ORDER BY sibling.id
          LIMIT 1
          ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
          DO UPDATE SET source_status='__ACTIVE__', planned_quantity=EXCLUDED.planned_quantity, updated_at=NOW()
          RETURNING id
        `,[stage,String(seed.opNumber),String(seed.scheduledDate),String(seed.seriesStart||''),String(seed.seriesEnd||'')]);
        if(!created.length) return NextResponse.json({ error: 'Não encontrei outra etapa da Prensa desta OP e deste dia para criar o Corpo Número de Série.' }, { status: 400 });
        scheduleId=Number(created[0].id);
      }
      if (!scheduleId && ['BORDA','ESTAMPAGEM','NÚMERO DE SÉRIE'].includes(String(entry.createSchedule?.operationType||'').trim().toUpperCase())) {
        if (role !== 'laser') return NextResponse.json({ error: 'Acesso Laser necessário.' }, { status: 401 });
        const seed=entry.createSchedule;
        const stage=String(seed.operationType).trim().toUpperCase();
        const created=await sql.query(`
          INSERT INTO process_schedule (
            process_type, operation_type, op_number, parent_op, scheduled_date,
            series_start, series_end, client_name, client_code, product_reference,
            product_description, production_line, power_pa, order_quantity,
            planned_quantity, source_status, updated_at
          )
          SELECT
            'BORDEADEIRA', $1, sibling.op_number, sibling.parent_op, sibling.scheduled_date,
            sibling.series_start, sibling.series_end, sibling.client_name, sibling.client_code, sibling.product_reference,
            sibling.product_description, sibling.production_line, sibling.power_pa, sibling.order_quantity,
            sibling.planned_quantity, '__ACTIVE__', NOW()
          FROM process_schedule sibling
          WHERE sibling.process_type='BORDEADEIRA'
            AND sibling.op_number=$2 AND sibling.scheduled_date=$3
            AND COALESCE(sibling.series_start,'')=COALESCE($4,'')
            AND COALESCE(sibling.series_end,'')=COALESCE($5,'')
            AND sibling.operation_type <> $1
            AND COALESCE(sibling.source_status,'') <> '__ARCHIVED__'
          ORDER BY sibling.id
          LIMIT 1
          ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
          DO UPDATE SET source_status='__ACTIVE__', planned_quantity=EXCLUDED.planned_quantity, updated_at=NOW()
          RETURNING id
        `,[stage,String(seed.opNumber),String(seed.scheduledDate),String(seed.seriesStart||''),String(seed.seriesEnd||'')]);
        if(!created.length) return NextResponse.json({ error: 'Não encontrei outra etapa da Bordadeira desta OP e deste dia para criar esta etapa.' }, { status: 400 });
        scheduleId=Number(created[0].id);
      }
      if (!scheduleId && String(entry.createSchedule?.operationType||'').trim().toUpperCase() === 'RADIADOR SOLDADO') {
        if (role !== 'laser') return NextResponse.json({ error: 'Acesso Laser necessário.' }, { status: 401 });
        const seed=entry.createSchedule;
        const created=await sql.query(`
          INSERT INTO process_schedule (
            process_type, operation_type, op_number, parent_op, scheduled_date,
            series_start, series_end, client_name, client_code, product_reference,
            product_description, production_line, power_pa, order_quantity,
            planned_quantity, source_status, updated_at
          )
          SELECT
            'RADIADOR', 'RADIADOR SOLDADO', sibling.op_number, sibling.parent_op, sibling.scheduled_date,
            sibling.series_start, sibling.series_end, sibling.client_name, sibling.client_code, sibling.product_reference,
            sibling.product_description, sibling.production_line, sibling.power_pa, sibling.order_quantity,
            sibling.planned_quantity, '__ACTIVE__', NOW()
          FROM process_schedule sibling
          WHERE sibling.process_type='RADIADOR'
            AND sibling.op_number=$1 AND sibling.scheduled_date=$2
            AND COALESCE(sibling.series_start,'')=COALESCE($3,'')
            AND COALESCE(sibling.series_end,'')=COALESCE($4,'')
            AND sibling.operation_type <> 'RADIADOR SOLDADO'
            AND COALESCE(sibling.source_status,'') <> '__ARCHIVED__'
          ORDER BY sibling.id
          LIMIT 1
          ON CONFLICT (process_type, operation_type, op_number, scheduled_date, series_start, series_end)
          DO UPDATE SET source_status='__ACTIVE__', planned_quantity=EXCLUDED.planned_quantity, updated_at=NOW()
          RETURNING id
        `,[String(seed.opNumber),String(seed.scheduledDate),String(seed.seriesStart||''),String(seed.seriesEnd||'')]);
        if(!created.length) return NextResponse.json({ error: 'Não encontrei a programação do Radiador para criar a etapa Radiador Soldado neste dia.' }, { status: 400 });
        scheduleId=Number(created[0].id);
      }
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
