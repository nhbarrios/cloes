-- ============================================================
-- El Mundo de Cloe — Esquema de base de datos (TiDB / MySQL 8)
-- ============================================================
-- TiDB es compatible con la sintaxis de MySQL, así que este
-- script corre igual en TiDB Cloud, TiDB Serverless o MySQL.
-- ============================================================

CREATE DATABASE IF NOT EXISTS mundo_de_cloe
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE mundo_de_cloe;

-- ------------------------------------------------------------
-- 1. CLIENTES
-- ------------------------------------------------------------
CREATE TABLE clients (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(150)  NOT NULL,
  phone         VARCHAR(30)   NULL,          -- se guarda solo con dígitos, ej. 50588888888
  address       TEXT          NULL,
  notes         TEXT          NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_name (name),
  INDEX idx_clients_phone (phone)
);

-- ------------------------------------------------------------
-- 2. PEDIDOS
-- ------------------------------------------------------------
CREATE TABLE orders (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  client_id     BIGINT        NOT NULL,
  order_date    DATE          NOT NULL,
  payment_type  ENUM('completo','contra_entrega','credito') NOT NULL,
  status        ENUM('pendiente','saldado','cancelado') NOT NULL DEFAULT 'pendiente',
  total         DECIMAL(12,2) NOT NULL DEFAULT 0,   -- suma de order_items (mantenido por trigger o app)
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE RESTRICT,
  INDEX idx_orders_client (client_id),
  INDEX idx_orders_date (order_date),
  INDEX idx_orders_status (status)
);

-- ------------------------------------------------------------
-- 3. ARTÍCULOS DE CADA PEDIDO
-- ------------------------------------------------------------
CREATE TABLE order_items (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id      BIGINT        NOT NULL,
  description   VARCHAR(200)  NOT NULL,
  quantity      DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(12,2) AS (quantity * unit_price) STORED,
  CONSTRAINT fk_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  INDEX idx_items_order (order_id)
);

-- ------------------------------------------------------------
-- 4. PAGOS / ABONOS
-- ------------------------------------------------------------
CREATE TABLE payments (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id      BIGINT        NOT NULL,
  client_id     BIGINT        NOT NULL,      -- denormalizado a propósito: acelera "estado de cuenta" por cliente
  amount        DECIMAL(12,2) NOT NULL,
  payment_date  DATE          NOT NULL,
  method        ENUM('efectivo','transferencia','tarjeta','otro') NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_payments_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE RESTRICT,
  INDEX idx_payments_order (order_id),
  INDEX idx_payments_client (client_id),
  INDEX idx_payments_date (payment_date)
);

-- ------------------------------------------------------------
-- 5. PROFORMAS / COTIZACIONES
-- ------------------------------------------------------------
CREATE TABLE proformas (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  client_id         BIGINT        NOT NULL,
  proforma_date     DATE          NOT NULL,
  validity_days     INT           NOT NULL DEFAULT 7,
  total             DECIMAL(12,2) NOT NULL DEFAULT 0,
  status            ENUM('pendiente','convertida','vencida','rechazada') NOT NULL DEFAULT 'pendiente',
  converted_order_id BIGINT       NULL,      -- se llena si se convirtió en pedido real
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proformas_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_proformas_order
    FOREIGN KEY (converted_order_id) REFERENCES orders(id)
    ON DELETE SET NULL,
  INDEX idx_proformas_client (client_id),
  INDEX idx_proformas_status (status)
);

CREATE TABLE proforma_items (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  proforma_id   BIGINT        NOT NULL,
  description   VARCHAR(200)  NOT NULL,
  quantity      DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(12,2) AS (quantity * unit_price) STORED,
  CONSTRAINT fk_pf_items_proforma
    FOREIGN KEY (proforma_id) REFERENCES proformas(id)
    ON DELETE CASCADE,
  INDEX idx_pf_items_proforma (proforma_id)
);

-- ------------------------------------------------------------
-- 6. REGISTRO DE DOCUMENTOS ENVIADOS (opcional pero recomendado)
--    Deja huella de cada comprobante / estado de cuenta enviado:
--    útil para saber "¿ya le mandé el recordatorio a fulano?"
-- ------------------------------------------------------------
CREATE TABLE document_log (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  client_id     BIGINT        NOT NULL,
  doc_type      ENUM('comprobante','estado_cuenta','proforma') NOT NULL,
  reference_id  BIGINT        NULL,   -- payment_id, proforma_id, etc. según doc_type
  channel       ENUM('imagen','whatsapp','texto') NOT NULL,
  sent_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_doclog_client
    FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE,
  INDEX idx_doclog_client (client_id)
);

-- ------------------------------------------------------------
-- 7. VISTA: saldo actual por cliente
--    (lo que hoy calcula clientBalance() en JavaScript)
-- ------------------------------------------------------------
CREATE VIEW client_balances AS
SELECT
  c.id                                   AS client_id,
  c.name                                 AS client_name,
  c.phone                                AS client_phone,
  COALESCE(SUM(o.total), 0)              AS total_ordered,
  COALESCE(SUM(p.paid), 0)               AS total_paid,
  COALESCE(SUM(o.total), 0) - COALESCE(SUM(p.paid), 0) AS balance_due
FROM clients c
LEFT JOIN orders o ON o.client_id = c.id
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid
  FROM payments
  GROUP BY order_id
) p ON p.order_id = o.id
GROUP BY c.id, c.name, c.phone;

-- ------------------------------------------------------------
-- 8. VISTA: saldo pendiente por pedido
--    (equivalente a orderPaid() / saldo en cada tarjeta de pedido)
-- ------------------------------------------------------------
CREATE VIEW order_balances AS
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
