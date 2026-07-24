// GET /api/utilidad?period=week|month|year&offset=N
//   offset=0 es el periodo actual, -1 el anterior, -2 el que sigue antes, etc.
//   (offset positivo no se permite: no se navega "al futuro")
//
// GET /api/utilidad?start=YYYY-MM-DD&end=YYYY-MM-DD
//   modo personalizado: cualquier rango de fechas que quieras.
//
// Calcula, para el rango resuelto:
//   revenue  = lo vendido (suma de artículos de pedidos, sin contar cancelados)
//   cost     = costo de esos artículos (unit_cost * cantidad)
//   grossProfit = revenue - cost
//   expenses = gastos generales registrados en ese rango de fechas
//   netProfit   = grossProfit - expenses
//
// Además devuelve `rows`: un desglose por sub-periodo (para la lista de
// la pantalla) y `rangeLabel`: un texto ya armado en español para mostrar
// arriba ("Julio 2026", "Semana del 21 al 27 jul", etc.)

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function toISO(d){ return d.toISOString().slice(0,10); }
function fmtDayMonth(d){ return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; }

function getRange(period, offset){
  const now = new Date();
  if(period === 'week'){
    const day = now.getUTCDay();
    const mondayOffset = (day === 0 ? -6 : 1 - day) + offset * 7;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { start, end };
  }
  if(period === 'year'){
    const y = now.getUTCFullYear() + offset;
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 31)) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { start, end };
}

function rangeLabel(period, start, end, isCustom){
  if(isCustom) return `${fmtDayMonth(start)} — ${fmtDayMonth(end)}, ${end.getUTCFullYear()}`;
  if(period === 'week') return `Semana del ${fmtDayMonth(start)} al ${fmtDayMonth(end)}`;
  if(period === 'year') return `${start.getUTCFullYear()}`;
  return `${MESES[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
}

// granularity: 'day' | 'weekOfMonth' | 'month'
function bucketKey(granularity, dateStr){
  const d = new Date(dateStr + 'T00:00:00Z');
  if(granularity === 'day') return dateStr;
  if(granularity === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  const weekOfMonth = Math.ceil(d.getUTCDate() / 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-S${weekOfMonth}`;
}
function bucketLabel(granularity, dateStr){
  const d = new Date(dateStr + 'T00:00:00Z');
  if(granularity === 'day') return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}/${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  if(granularity === 'month') return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `Semana ${Math.ceil(d.getUTCDate() / 7)}`;
}

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (!requireAuth(event)) return unauthorized();
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  const qs = event.queryStringParameters || {};
  const isCustom = !!(qs.start && qs.end);
  let period = qs.period || 'month';
  let offset = Number(qs.offset || 0);
  if (!['week','month','year'].includes(period)) period = 'month';
  if (offset > 0) offset = 0; // no se navega al futuro

  try {
    let start, end, granularity;
    if (isCustom) {
      start = new Date(qs.start + 'T00:00:00Z');
      end = new Date(qs.end + 'T00:00:00Z');
      if (isNaN(start) || isNaN(end) || start > end) return json(400, { error: 'Rango de fechas inválido' });
      const days = Math.round((end - start) / 86400000) + 1;
      granularity = days <= 45 ? 'day' : 'month';
    } else {
      const r = getRange(period, offset);
      start = r.start; end = r.end;
      granularity = period === 'week' ? 'day' : (period === 'year' ? 'month' : 'weekOfMonth');
    }
    const startStr = toISO(start), endStr = toISO(end);

    const [saleRows] = await pool.query(
      `SELECT o.order_date, o.id AS order_id, o.client_id, oi.quantity, oi.unit_price, oi.unit_cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.order_date BETWEEN ? AND ? AND o.status <> 'cancelado'`,
      [startStr, endStr]
    );
    const [expenseRows] = await pool.query(
      `SELECT id, expense_date, amount, category, description FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [startStr, endStr]
    );

    const buckets = {};
    const ensure = (key, dateStr) => {
      if (!buckets[key]) buckets[key] = { key, label: bucketLabel(granularity, dateStr), revenue: 0, cost: 0, expenses: 0 };
      return buckets[key];
    };

    let revenue = 0, cost = 0;
    const orderIds = new Set(), clientIds = new Set();
    for (const r of saleRows) {
      const dateStr = (r.order_date instanceof Date) ? toISO(r.order_date) : String(r.order_date).slice(0,10);
      const lineRevenue = Number(r.quantity) * Number(r.unit_price);
      const lineCost = Number(r.quantity) * Number(r.unit_cost || 0);
      revenue += lineRevenue; cost += lineCost;
      orderIds.add(r.order_id); clientIds.add(r.client_id);
      const b = ensure(bucketKey(granularity, dateStr), dateStr);
      b.revenue += lineRevenue; b.cost += lineCost;
    }

    let expensesTotal = 0;
    for (const r of expenseRows) {
      const dateStr = (r.expense_date instanceof Date) ? toISO(r.expense_date) : String(r.expense_date).slice(0,10);
      const amt = Number(r.amount);
      expensesTotal += amt;
      const b = ensure(bucketKey(granularity, dateStr), dateStr);
      b.expenses += amt;
    }

    const rows = Object.values(buckets)
      .map(b => ({ ...b, profit: b.revenue - b.cost - b.expenses }))
      .sort((a,b)=> a.key.localeCompare(b.key));

    const totals = {
      revenue, cost,
      grossProfit: revenue - cost,
      expenses: expensesTotal,
      profit: revenue - cost - expensesTotal,
      orders: orderIds.size,
      clients: clientIds.size,
    };

    return json(200, {
      period, offset, isCustom,
      range: { start: startStr, end: endStr },
      rangeLabel: rangeLabel(period, start, end, isCustom),
      canGoNext: !isCustom && offset < 0,
      totals, rows,
      expenseDetail: expenseRows,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
