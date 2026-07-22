// POST   /api/orders
// body: {
//   clientId, orderDate, paymentType: 'completo'|'contra_entrega'|'credito',
//   method: 'efectivo'|'transferencia'|'tarjeta'|'otro'   (solo si paymentType='completo')
//   items: [{ description, quantity, unitPrice }, ...]
// }
//
// Si paymentType es 'completo', además del pedido se crea automáticamente
// el pago por el total — igual que hace hoy la app en el navegador.
//
// PUT    /api/orders?id=8
// body: { orderDate, paymentType, items: [{ description, quantity, unitPrice }, ...] }
//   -> corrige un pedido: reemplaza sus artículos (arregla precios/productos
//      mal escritos) y recalcula el total. No toca los abonos ya registrados,
//      pero re-evalúa si el pedido queda saldado o pendiente con el nuevo total.
//
// DELETE /api/orders?id=8
//   -> elimina un pedido (arrastra en cascada sus artículos y abonos). Útil
//      para borrar un pedido duplicado.

const { getPool, json, isPreflight } = require('./_db');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});

  const pool = getPool();

  if (event.httpMethod === 'PUT') {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) return json(400, { error: 'Falta id' });

    const conn = await pool.getConnection();
    try {
      const body = JSON.parse(event.body || '{}');
      const { orderDate, paymentType, items } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return json(400, { error: 'El pedido necesita al menos un artículo' });
      }
      if (!['completo', 'contra_entrega', 'credito'].includes(paymentType)) {
        return json(400, { error: 'paymentType inválido' });
      }

      const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
      if (!order) return json(404, { error: 'Pedido no encontrado' });

      const total = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0);
      const date = orderDate || order.order_date;

      await conn.beginTransaction();

      await conn.query(
        `UPDATE orders SET order_date = ?, payment_type = ?, total = ? WHERE id = ?`,
        [date, paymentType, total, id]
      );

      await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);
      for (const it of items) {
        await conn.query(
          `INSERT INTO order_items (order_id, description, quantity, unit_price)
           VALUES (?, ?, ?, ?)`,
          [id, it.description, it.quantity, it.unitPrice]
        );
      }

      // Re-evalúa el estado según lo ya abonado contra el nuevo total
      const [[paidRow]] = await conn.query(
        'SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE order_id = ?',
        [id]
      );
      const newStatus = Number(paidRow.paid) >= total - 0.009 ? 'saldado' : 'pendiente';
      await conn.query('UPDATE orders SET status = ? WHERE id = ?', [newStatus, id]);

      await conn.commit();
      return json(200, { orderId: Number(id), total, status: newStatus });
    } catch (err) {
      await conn.rollback();
      console.error(err);
      return json(500, { error: 'Error del servidor', detail: err.message });
    } finally {
      conn.release();
    }
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) return json(400, { error: 'Falta id' });

    try {
      const [[order]] = await pool.query('SELECT id FROM orders WHERE id = ?', [id]);
      if (!order) return json(404, { error: 'Pedido no encontrado' });

      await pool.query('DELETE FROM orders WHERE id = ?', [id]); // cascada: items + payments
      return json(200, { deleted: true, id: Number(id) });
    } catch (err) {
      console.error(err);
      return json(500, { error: 'Error del servidor', detail: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  const conn = await pool.getConnection();

  try {
    const body = JSON.parse(event.body || '{}');
    const { clientId, orderDate, paymentType, method, items } = body;

    if (!clientId) return json(400, { error: 'Falta clientId' });
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { error: 'El pedido necesita al menos un artículo' });
    }
    if (!['completo', 'contra_entrega', 'credito'].includes(paymentType)) {
      return json(400, { error: 'paymentType inválido' });
    }

    const total = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0);
    const date = orderDate || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();

    const [orderResult] = await conn.query(
      `INSERT INTO orders (client_id, order_date, payment_type, status, total)
       VALUES (?, ?, ?, 'pendiente', ?)`,
      [clientId, date, paymentType, total]
    );
    const orderId = orderResult.insertId;

    for (const it of items) {
      await conn.query(
        `INSERT INTO order_items (order_id, description, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
        [orderId, it.description, it.quantity, it.unitPrice]
      );
    }

    let payment = null;
    if (paymentType === 'completo') {
      const payMethod = method || 'efectivo';
      const [payResult] = await conn.query(
        `INSERT INTO payments (order_id, client_id, amount, payment_date, method)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, clientId, total, date, payMethod]
      );
      await conn.query(`UPDATE orders SET status = 'saldado' WHERE id = ?`, [orderId]);
      payment = { id: payResult.insertId, orderId, amount: total, method: payMethod, date };
    }

    await conn.commit();
    return json(201, { orderId, total, payment });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  } finally {
    conn.release();
  }
};
