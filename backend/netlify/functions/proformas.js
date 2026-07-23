// POST /api/proformas
//   body: { clientId, proformaDate, validityDays, items: [{description, quantity, unitPrice}] }
//
// POST /api/proformas?action=convert
//   body: { proformaId, paymentType, method }
//   -> crea un pedido real con los mismos artículos de la proforma
//      y marca la proforma como 'convertida'

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  if (!requireAuth(event)) return unauthorized();
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  const pool = getPool();
  const action = event.queryStringParameters && event.queryStringParameters.action;

  if (action === 'convert') return convertProforma(pool, event);
  return createProforma(pool, event);
};

async function createProforma(pool, event) {
  const conn = await pool.getConnection();
  try {
    const body = JSON.parse(event.body || '{}');
    const { clientId, proformaDate, validityDays, items } = body;

    if (!clientId) return json(400, { error: 'Falta clientId' });
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { error: 'La proforma necesita al menos un artículo' });
    }

    const total = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0);
    const date = proformaDate || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    const [pfResult] = await conn.query(
      `INSERT INTO proformas (client_id, proforma_date, validity_days, total, status)
       VALUES (?, ?, ?, ?, 'pendiente')`,
      [clientId, date, validityDays || 7, total]
    );
    const proformaId = pfResult.insertId;

    for (const it of items) {
      await conn.query(
        `INSERT INTO proforma_items (proforma_id, description, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
        [proformaId, it.description, it.quantity, it.unitPrice]
      );
    }

    await conn.commit();
    return json(201, { proformaId, total, validityDays: validityDays || 7, date });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  } finally {
    conn.release();
  }
}

async function convertProforma(pool, event) {
  const conn = await pool.getConnection();
  try {
    const body = JSON.parse(event.body || '{}');
    const { proformaId, paymentType, method } = body;
    if (!proformaId) return json(400, { error: 'Falta proformaId' });
    if (!['completo', 'contra_entrega', 'credito'].includes(paymentType)) {
      return json(400, { error: 'paymentType inválido' });
    }

    const [[pf]] = await conn.query('SELECT * FROM proformas WHERE id = ?', [proformaId]);
    if (!pf) return json(404, { error: 'Proforma no encontrada' });
    if (pf.status === 'convertida') return json(409, { error: 'Esta proforma ya fue convertida' });

    const [items] = await conn.query('SELECT * FROM proforma_items WHERE proforma_id = ?', [proformaId]);

    await conn.beginTransaction();

    const today = new Date().toISOString().slice(0, 10);
    const [orderResult] = await conn.query(
      `INSERT INTO orders (client_id, order_date, payment_type, status, total)
       VALUES (?, ?, ?, 'pendiente', ?)`,
      [pf.client_id, today, paymentType, pf.total]
    );
    const orderId = orderResult.insertId;

    for (const it of items) {
      await conn.query(
        `INSERT INTO order_items (order_id, description, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
        [orderId, it.description, it.quantity, it.unit_price]
      );
    }

    let payment = null;
    if (paymentType === 'completo') {
      const payMethod = method || 'efectivo';
      const [payResult] = await conn.query(
        `INSERT INTO payments (order_id, client_id, amount, payment_date, method)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, pf.client_id, pf.total, today, payMethod]
      );
      await conn.query(`UPDATE orders SET status = 'saldado' WHERE id = ?`, [orderId]);
      payment = { id: payResult.insertId, amount: pf.total, method: payMethod, date: today };
    }

    await conn.query(
      `UPDATE proformas SET status = 'convertida', converted_order_id = ? WHERE id = ?`,
      [orderId, proformaId]
    );

    await conn.commit();
    return json(201, { orderId, total: pf.total, payment });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  } finally {
    conn.release();
  }
}
