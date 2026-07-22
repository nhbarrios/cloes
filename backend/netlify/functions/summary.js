// GET /api/summary
// Devuelve los totales para las 3 tarjetas del encabezado:
// clientes, por cobrar, pedidos.

const { getPool, json, isPreflight } = require('./_db');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  try {
    const [[{ totalClients }]] = await pool.query('SELECT COUNT(*) AS totalClients FROM clients');
    const [[{ totalOrders }]] = await pool.query('SELECT COUNT(*) AS totalOrders FROM orders');
    const [[{ totalDebt }]] = await pool.query(
      'SELECT COALESCE(SUM(GREATEST(balance_due,0)),0) AS totalDebt FROM client_balances'
    );

    return json(200, { totalClients, totalOrders, totalDebt });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
