// _auth.js — utilidades de sesión compartidas por las demás funciones.
// El guion bajo le indica a Netlify que esto no es un endpoint público.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRET = process.env.JWT_SECRET;
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 7; // 7 días

function signToken(user) {
  if (!SECRET) throw new Error('Falta configurar JWT_SECRET en las variables de entorno');
  const payload = { id: user.id, username: user.username, role: user.role, fullName: user.full_name || null };
  const token = jwt.sign(payload, SECRET, { expiresIn: TOKEN_LIFETIME_SECONDS });
  const expiresAt = Date.now() + TOKEN_LIFETIME_SECONDS * 1000;
  return { token, expiresAt, user: payload };
}

// Devuelve el usuario del token si es válido, o null si no hay token / es inválido / expiró.
function getUserFromEvent(event) {
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return jwt.verify(match[1], SECRET);
  } catch (err) {
    return null;
  }
}

// Usan las demás funciones (clients.js, orders.js, etc.) al inicio de su handler:
//   const user = requireAuth(event);
//   if (!user) return unauthorized();
function requireAuth(event) {
  return getUserFromEvent(event);
}

function requireAdmin(event) {
  const user = getUserFromEvent(event);
  if (!user || user.role !== 'admin') return null;
  return user;
}

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: JSON.stringify({ error: 'Sesión inválida o expirada' }),
  };
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { signToken, getUserFromEvent, requireAuth, requireAdmin, unauthorized, hashPassword, verifyPassword };
