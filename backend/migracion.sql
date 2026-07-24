-- ============================================================
-- Migración: login con usuarios, gastos generales y costo por
-- artículo (para calcular utilidades reales).
-- ============================================================
-- Ejecuta esto UNA VEZ en el SQL Editor de TiDB Cloud, en la
-- misma base de datos "mundo_de_cloe" donde ya tienes tus tablas.
-- Es seguro correrlo: no borra ni toca tus datos existentes.
-- ============================================================

USE mundo_de_cloe;

-- ------------------------------------------------------------
-- 1. USUARIOS (para el login — varias cuentas: tú y tu empleado)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(50)   NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  full_name     VARCHAR(100)  NULL,
  role          ENUM('admin','empleado') NOT NULL DEFAULT 'empleado',
  active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 2. GASTOS GENERALES DEL NEGOCIO
--    (renta, publicidad, empaques, transporte, etc. — no ligados
--    a un pedido en particular)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  expense_date  DATE          NOT NULL,
  category      VARCHAR(80)   NULL,
  description   VARCHAR(200)  NULL,
  amount        DECIMAL(12,2) NOT NULL,
  created_by    BIGINT        NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_user
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_expenses_date (expense_date)
);

-- ------------------------------------------------------------
-- 3. COSTO DE CADA ARTÍCULO VENDIDO
--    (para poder calcular: precio de venta − costo = utilidad)
-- ------------------------------------------------------------
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_price;

-- ------------------------------------------------------------
-- 4. Que los pedidos CANCELADOS ya no cuenten en "por cobrar"
--    ni en el total facturado por cliente. (Recrea las mismas
--    vistas que ya tenías, solo agregando ese filtro.)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW client_balances AS
SELECT
  c.id                                   AS client_id,
  c.name                                 AS client_name,
  c.phone                                AS client_phone,
  COALESCE(SUM(o.total), 0)              AS total_ordered,
  COALESCE(SUM(p.paid), 0)               AS total_paid,
  COALESCE(SUM(o.total), 0) - COALESCE(SUM(p.paid), 0) AS balance_due
FROM clients c
LEFT JOIN orders o ON o.client_id = c.id AND o.status <> 'cancelado'
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid
  FROM payments
  GROUP BY order_id
) p ON p.order_id = o.id
GROUP BY c.id, c.name, c.phone;

CREATE OR REPLACE VIEW order_balances AS
SELECT
  o.id                                  AS order_id,
  o.client_id,
  o.order_date,
  o.payment_type,
  o.total,
  COALESCE(SUM(p.amount), 0)            AS paid,
  o.total - COALESCE(SUM(p.amount), 0)  AS balance_due
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
GROUP BY o.id, o.client_id, o.order_date, o.payment_type, o.total;
-- (esta vista sigue mostrando TODOS los pedidos, cancelados incluidos —
--  clients.js la necesita para no perder pedidos cancelados del historial.
--  Lo que sí queda excluido de "por cobrar" es client_balances, abajo.)
