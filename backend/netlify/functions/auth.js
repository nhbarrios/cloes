// POST /api/auth
//   body: { username, password }
//   -> inicia sesión. Devuelve { token, expiresAt, user }
//
// POST /api/auth?action=bootstrap
//   body: { username, password, fullName }
//   -> crea la PRIMERA cuenta (admin). Solo funciona si todavía no
//      existe ningún usuario — después queda bloqueado para siempre.
//
// POST /api/auth?action=register   (requiere sesión de administrador)
//   body: { username, password, fullName, role: 'admin'|'empleado' }
//   -> crea una cuenta nueva (ej. la de tu empleado).
//
// GET  /api/auth?action=users      (requiere sesión de administrador)
//   -> lista las cuentas existentes (sin contraseñas).
//
// DELETE /api/auth?id=3            (requiere sesión de administrador)
//   -> elimina una cuenta (no puedes borrar la tuya propia).
//
// GET  /api/auth?action=me         (requiere sesión)
//   -> confirma quién eres según el token.

const { getPool, json, isPreflight } = require('./_db');
const { signToken, getUserFromEvent, requireAdmin, unauthorized, hashPassword, verifyPassword } = require('./_auth');

exports.handler = async (event) => {
  if (isPreflight(event)) return json(200, {});
  const pool = getPool();
  const action = event.queryStringParameters && event.queryStringParameters.action;

  try {
    if (event.httpMethod === 'GET' && action === 'status') {
      const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
      return json(200, { hasAdmin: total > 0 });
    }

    if (event.httpMethod === 'GET' && action === 'me') {
      const user = getUserFromEvent(event);
      if (!user) return unauthorized();
      return json(200, { user });
    }

    if (event.httpMethod === 'GET' && action === 'users') {
      const admin = requireAdmin(event);
      if (!admin) return unauthorized();
      const [rows] = await pool.query(
        'SELECT id, username, full_name, role, active, created_at FROM users ORDER BY created_at ASC'
      );
      return json(200, { users: rows });
    }

    if (event.httpMethod === 'POST' && action === 'bootstrap') {
      const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
      if (total > 0) return json(403, { error: 'Ya existe una cuenta de administrador. Pide a tu admin que te cree un usuario.' });

      const body = JSON.parse(event.body || '{}');
      const { username, password, fullName } = body;
      if (!username || !password) return json(400, { error: 'Usuario y contraseña son obligatorios' });
      if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres' });

      const hash = await hashPassword(password);
      const [result] = await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')`,
        [username.trim(), hash, fullName || null]
      );
      const user = { id: result.insertId, username: username.trim(), full_name: fullName || null, role: 'admin' };
      return json(201, signToken(user));
    }

    if (event.httpMethod === 'POST' && action === 'register') {
      const admin = requireAdmin(event);
      if (!admin) return unauthorized();

      const body = JSON.parse(event.body || '{}');
      const { username, password, fullName, role } = body;
      if (!username || !password) return json(400, { error: 'Usuario y contraseña son obligatorios' });
      if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres' });
      const finalRole = role === 'admin' ? 'admin' : 'empleado';

      const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username.trim()]);
      if (existing) return json(409, { error: 'Ese usuario ya existe' });

      const hash = await hashPassword(password);
      const [result] = await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`,
        [username.trim(), hash, fullName || null, finalRole]
      );
      return json(201, { id: result.insertId, username: username.trim(), full_name: fullName || null, role: finalRole });
    }

    if (event.httpMethod === 'DELETE') {
      const admin = requireAdmin(event);
      if (!admin) return unauthorized();
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: 'Falta id' });
      if (Number(id) === admin.id) return json(400, { error: 'No puedes eliminar tu propia cuenta' });

      const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
      if (result.affectedRows === 0) return json(404, { error: 'Usuario no encontrado' });
      return json(200, { deleted: true, id: Number(id) });
    }

    if (event.httpMethod === 'POST' && !action) {
      const body = JSON.parse(event.body || '{}');
      const { username, password } = body;
      if (!username || !password) return json(400, { error: 'Usuario y contraseña son obligatorios' });

      const [[user]] = await pool.query(
        'SELECT * FROM users WHERE username = ? AND active = 1',
        [username.trim()]
      );
      if (!user) return json(401, { error: 'Usuario o contraseña incorrectos' });

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) return json(401, { error: 'Usuario o contraseña incorrectos' });

      return json(200, signToken(user));
    }

    return json(405, { error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Error del servidor', detail: err.message });
  }
};
