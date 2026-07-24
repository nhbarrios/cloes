// GET    /api/clients            -> lista todos los clientes con su saldo
// GET    /api/clients?id=5       -> detalle de un cliente + sus pedidos y pagos
// POST   /api/clients             -> crea un cliente  { name, phone, address }
// PUT    /api/clients?id=5       -> edita un cliente  { name, phone, address, notes }
// DELETE /api/clients?id=5       -> elimina un cliente y TODO lo asociado
//                                    (pedidos, artículos, pagos, proformas)

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  const pool = getPool();
  if (!requireAuth(event)) return unauthorized();

  try {
    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters && event.queryStringParameters.id;

      if (id) {
        // --- Detalle de un cliente ---
        const [[client]] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
        if (!client) return json(404, { error: 'Cliente no encontrado' });

        const [orders] = await pool.query(
          `SELECT o.*, ob.paid, ob.balance_due
           FROM orders o
           LEFT JOIN order_balances ob ON ob.order_id = o.id
           WHERE o.client_id = ?
           ORDER BY o.order_date DESC`,
          [id]
        );

        for (const order of orders) {
          const [items] = await pool.query(
            'SELECT id, description, quantity, unit_price, unit_cost, subtotal FROM order_items WHERE order_id = ?',
            [order.id]
          );
          order.items = items;
        }

        const [payments] = await pool.query(
          `SELECT * FROM payments WHERE client_id = ? ORDER BY payment_date DESC LIMIT 20`,
          [id]
        );

        const [[balance]] = await pool.query(
          'SELECT total_ordered, total_paid, balance_due FROM client_balances WHERE client_id = ?',
          [id]
        );

        return json(200, { client, orders, payments, balance: balance || { total_ordered: 0, total_paid: 0, balance_due: 0 } });
      }

      // --- Lista de todos los clientes con saldo ---
      const [rows] = await pool.query(
        `SELECT c.id, c.name, c.phone, c.address,
                COALESCE(cb.total_ordered,0) AS total_ordered,
                COALESCE(cb.total_paid,0)    AS total_paid,
                COALESCE(cb.balance_due,0)   AS balance_due
         FROM clients c
         LEFT JOIN client_balances cb ON cb.client_id = c.id
         ORDER BY balance_due DESC, c.name ASC`
      );
      return json(200, { clients: rows });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { name, phone, address, notes } = body;
      if (!name || !name.trim()) return json(400, { error: 'El nombre es obligatorio' });

      const [result] = await pool.query(
        'INSERT INTO clients (name, phone, address, notes) VALUES (?, ?, ?, ?)',
        [name.trim(), phone || null, address || null, notes || null]
      );
      return json(201, { id: result.insertId, name, phone, address });
    }

    if (event.httpMethod === 'PUT') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: 'Falta id' });

      const body = JSON.parse(event.body || '{}');
      const { name, phone, address, notes } = body;
      if (!name || !name.trim()) return json(400, { error: 'El nombre es obligatorio' });

      const [result] = await pool.query(
        'UPDATE clients SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ?',
        [name.trim(), phone || null, address || null, notes || null, id]
      );
      if (result.affectedRows === 0) return json(404, { error: 'Cliente no encontrado' });

      return json(200, { id: Number(id), name, phone, address, notes });
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: 'Falta id' });

      const conn = await pool.getConnection();
      try {
        const [[client]] = await conn.query('SELECT id FROM clients WHERE id = ?', [id]);
        if (!client) { conn.release(); return json(404, { error: 'Cliente no encontrado' }); }

        await conn.beginTransaction();
        // Borra pedidos del cliente (esto arrastra en cascada order_items y payments)
        await conn.query('DELETE FROM orders WHERE client_id = ?', [id]);
        // Borra proformas del cliente (arrastra en cascada proforma_items)
        await conn.query('DELETE FROM proformas WHERE client_id = ?', [id]);
        // Finalmente el cliente (document_log se borra solo, tiene CASCADE)
        await conn.query('DELETE FROM clients WHERE id = ?', [id]);
        await conn.commit();

        return json(200, { deleted: true, id: Number(id) });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
