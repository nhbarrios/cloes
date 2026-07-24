// POST /api/payments
// body: { orderId, amount, paymentDate, method }
//
// Registra un abono, y si con este abono el pedido queda saldado,
// actualiza automáticamente orders.status a 'saldado'.

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (!requireAuth(event)) return unauthorized();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    const body = JSON.parse(event.body || '{}');
    const { orderId, amount, paymentDate, method } = body;

    if (!orderId || !amount || Number(amount) <= 0) {
      return json(400, { error: 'orderId y amount (mayor a 0) son obligatorios' });
    }

    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return json(404, { error: 'Pedido no encontrado' });

    const date = paymentDate || new Date().toISOString().slice(0, 10);
    const payMethod = method || 'efectivo';

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO payments (order_id, client_id, amount, payment_date, method)
       VALUES (?, ?, ?, ?, ?)`,
      [orderId, order.client_id, amount, date, payMethod]
    );

    const [[balanceRow]] = await conn.query(
      'SELECT paid, balance_due FROM order_balances WHERE order_id = ?',
      [orderId]
    );

    if (balanceRow && Number(balanceRow.balance_due) <= 0.009) {
      await conn.query(`UPDATE orders SET status = 'saldado' WHERE id = ?`, [orderId]);
    }

    await conn.commit();

    return json(201, {
      id: result.insertId,
      orderId,
      amount,
      date,
      method: payMethod,
      orderTotal: order.total,
      paidToDate: balanceRow ? balanceRow.paid : amount,
      balanceDue: balanceRow ? balanceRow.balance_due : order.total - amount,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  } finally {
    conn.release();
  }
};
