// _db.js
// Conexión compartida a TiDB Cloud. El guion bajo al inicio del nombre
// le indica a Netlify que este archivo NO es un endpoint público,
// solo una utilidad que importan las demás funciones.

const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.TIDB_HOST,
      port: Number(process.env.TIDB_PORT || 4000),
      user: process.env.TIDB_USER,
      password: process.env.TIDB_PASSWORD,
      database: process.env.TIDB_DATABASE,
      // TiDB Cloud exige conexión cifrada (TLS)
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 3, // las funciones serverless deben usar pools pequeños
      maxIdle: 3,
      idleTimeout: 30000,
      enableKeepAlive: true,
    });
  }
  return pool;
}

// Respuesta JSON estándar con cabeceras CORS
// (así el navegador puede llamar a estas funciones desde tu dominio de Netlify)
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

// Atajo para manejar el preflight OPTIONS que manda el navegador
function isPreflight(event) {
  return event.httpMethod === 'OPTIONS';
}

module.exports = { getPool, json, isPreflight };
