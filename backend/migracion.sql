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
