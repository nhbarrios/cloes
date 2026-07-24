// GET /api/summary                       -> totales de TODO el negocio (histórico)
// GET /api/summary?scope=month           -> totales de SOLO el mes en curso
// GET /api/summary?scope=date&date=YYYY-MM-DD  -> totales de un día específico
//   totalClients = clientes distintos que compraron en ese rango
//   totalOrders  = pedidos hechos en ese rango
//   totalDebt    = saldo pendiente de esos pedidos
// (en todos los casos se ignoran los pedidos cancelados)

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

function toISO(d){ return d.toISOString().slice(0,10); }
function monthRange(){
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: toISO(start), end: toISO(end) };
}

async function rangeTotals(pool, start, end){
  const [[{ totalClients }]] = await pool.query(
    `SELECT COUNT(DISTINCT client_id) AS totalClients
     FROM orders WHERE status <> 'cancelado' AND order_date BETWEEN ? AND ?`,
    [start, end]
  );
  const [[{ totalOrders }]] = await pool.query(
    `SELECT COUNT(*) AS totalOrders
     FROM orders WHERE status <> 'cancelado' AND order_date BETWEEN ? AND ?`,
    [start, end]
  );
  const [[{ totalDebt }]] = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(ob.balance_due,0)),0) AS totalDebt
     FROM order_balances ob
     JOIN orders o ON o.id = ob.order_id
     WHERE o.status <> 'cancelado' AND o.order_date BETWEEN ? AND ?`,
    [start, end]
  );
  return { totalClients, totalOrders, totalDebt };
}

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (!requireAuth(event)) return unauthorized();
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  const qs = event.queryStringParameters || {};
  const scope = qs.scope || 'all';

  try {
    if (scope === 'month') {
      const { start, end } = monthRange();
      const totals = await rangeTotals(pool, start, end);
      return json(200, { ...totals, scope: 'month', range: { start, end } });
    }

    if (scope === 'date') {
      const date = qs.date;
      if (!date || isNaN(new Date(date + 'T00:00:00Z'))) return json(400, { error: 'Fecha inválida' });
      const totals = await rangeTotals(pool, date, date);
      return json(200, { ...totals, scope: 'date', range: { start: date, end: date } });
    }

    const [[{ totalClients }]] = await pool.query('SELECT COUNT(*) AS totalClients FROM clients');
    const [[{ totalOrders }]] = await pool.query("SELECT COUNT(*) AS totalOrders FROM orders WHERE status <> 'cancelado'");
    const [[{ totalDebt }]] = await pool.query(
      'SELECT COALESCE(SUM(GREATEST(balance_due,0)),0) AS totalDebt FROM client_balances'
    );

    return json(200, { totalClients, totalOrders, totalDebt, scope: 'all' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
