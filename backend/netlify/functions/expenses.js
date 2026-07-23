// GET    /api/expenses               -> lista los gastos más recientes (máx 200)
// GET    /api/expenses?id=5          -> un gasto puntual
// POST   /api/expenses               -> crea un gasto  { expenseDate, category, description, amount }
// PUT    /api/expenses?id=5          -> edita un gasto
// DELETE /api/expenses?id=5          -> elimina un gasto

const { getPool, json, isPreflight } = require('./_db');
const { requireAuth, unauthorized } = require('./_auth');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  const user = requireAuth(event);
  if (!user) return unauthorized();

  const pool = getPool();
  const id = event.queryStringParameters && event.queryStringParameters.id;

  try {
    if (event.httpMethod === 'GET') {
      if (id) {
        const [[expense]] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
        if (!expense) return json(404, { error: 'Gasto no encontrado' });
        return json(200, { expense });
      }
      const [rows] = await pool.query('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 200');
      return json(200, { expenses: rows });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { expenseDate, category, description, amount } = body;
      if (!amount || Number(amount) <= 0) return json(400, { error: 'El monto debe ser mayor a 0' });
      const date = expenseDate || new Date().toISOString().slice(0, 10);

      const [result] = await pool.query(
        `INSERT INTO expenses (expense_date, category, description, amount, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [date, category || null, description || null, amount, user.id]
      );
      return json(201, { id: result.insertId, expenseDate: date, category, description, amount });
    }

    if (event.httpMethod === 'PUT') {
      if (!id) return json(400, { error: 'Falta id' });
      const body = JSON.parse(event.body || '{}');
      const { expenseDate, category, description, amount } = body;
      if (!amount || Number(amount) <= 0) return json(400, { error: 'El monto debe ser mayor a 0' });

      const [result] = await pool.query(
        `UPDATE expenses SET expense_date = ?, category = ?, description = ?, amount = ? WHERE id = ?`,
        [expenseDate || new Date().toISOString().slice(0, 10), category || null, description || null, amount, id]
      );
      if (result.affectedRows === 0) return json(404, { error: 'Gasto no encontrado' });
      return json(200, { id: Number(id), expenseDate, category, description, amount });
    }

    if (event.httpMethod === 'DELETE') {
      if (!id) return json(400, { error: 'Falta id' });
      const [result] = await pool.query('DELETE FROM expenses WHERE id = ?', [id]);
      if (result.affectedRows === 0) return json(404, { error: 'Gasto no encontrado' });
      return json(200, { deleted: true, id: Number(id) });
    }

    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
