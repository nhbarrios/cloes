// GET /api/utilidad?period=week|month|year
//
// Calcula, para el periodo actual (semana/mes/año en curso):
//   revenue  = lo vendido (suma de artículos de pedidos, sin contar cancelados)
//   cost     = costo de esos artículos (unit_cost * cantidad)
//   grossProfit = revenue - cost
//   expenses = gastos generales registrados en ese rango de fechas
//   netProfit   = grossProfit - expenses
//
// Además devuelve un desglose (`buckets`) por sub-periodo para la
// lista de la pantalla: días si es semana, semanas si es mes, meses
// si es año.

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function toISO(d){ return d.toISOString().slice(0,10); }

function getRange(period){
  const now = new Date();
  if(period === 'week'){
    const day = now.getUTCDay(); // 0=domingo
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { start, end };
  }
  if(period === 'year'){
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
    return { start, end };
  }
  // month (default)
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start, end };
}

function bucketKey(period, dateStr){
  const d = new Date(dateStr + 'T00:00:00Z');
  if(period === 'week') return toISO(d);
  if(period === 'year') return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  // month -> agrupa por semana del mes (1-5)
  const weekOfMonth = Math.ceil(d.getUTCDate() / 7);
  return `S${weekOfMonth}`;
}
function bucketLabel(period, key, dateStr){
  const d = new Date((dateStr||key) + 'T00:00:00Z');
  if(period === 'week') return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
  if(period === 'year') return MESES[Number(key.split('-')[1]) - 1];
  return `Semana ${key.slice(1)}`;
}

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (!requireAuth(event)) return unauthorized();
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  const period = (event.queryStringParameters && event.queryStringParameters.period) || 'month';
  if (!['week','month','year'].includes(period)) return json(400, { error: 'period inválido' });

  try {
    const { start, end } = getRange(period);
    const startStr = toISO(start), endStr = toISO(end);

    const [saleRows] = await pool.query(
      `SELECT o.order_date, oi.quantity, oi.unit_price, oi.unit_cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.order_date BETWEEN ? AND ? AND o.status <> 'cancelado'`,
      [startStr, endStr]
    );
    const [expenseRows] = await pool.query(
      `SELECT expense_date, amount, category, description FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [startStr, endStr]
    );

    const buckets = {}; // key -> {revenue,cost,expenses,label,dateStr}
    const ensure = (key, dateStr) => {
      if (!buckets[key]) buckets[key] = { key, label: bucketLabel(period, key, dateStr), revenue: 0, cost: 0, expenses: 0 };
      return buckets[key];
    };

    let revenue = 0, cost = 0;
    for (const r of saleRows) {
      const dateStr = (r.order_date instanceof Date) ? toISO(r.order_date) : String(r.order_date).slice(0,10);
      const lineRevenue = Number(r.quantity) * Number(r.unit_price);
      const lineCost = Number(r.quantity) * Number(r.unit_cost || 0);
      revenue += lineRevenue; cost += lineCost;
      const b = ensure(bucketKey(period, dateStr), dateStr);
      b.revenue += lineRevenue; b.cost += lineCost;
    }

    let expensesTotal = 0;
    for (const r of expenseRows) {
      const dateStr = (r.expense_date instanceof Date) ? toISO(r.expense_date) : String(r.expense_date).slice(0,10);
      const amt = Number(r.amount);
      expensesTotal += amt;
      const b = ensure(bucketKey(period, dateStr), dateStr);
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
    };

    return json(200, {
      period, range: { start: startStr, end: endStr },
      totals, rows,
      expenseDetail: expenseRows,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
