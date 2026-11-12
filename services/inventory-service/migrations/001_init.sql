CREATE TABLE IF NOT EXISTS products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_stock (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT valid_stock CHECK (
    on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand
  )
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_reservation_status CHECK (
    status IN ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED')
  )
);

CREATE TABLE IF NOT EXISTS reservation_items (
  reservation_id UUID NOT NULL REFERENCES reservations(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (reservation_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reservations_expires_at
ON reservations(expires_at);

-- Initial products for testing.
INSERT INTO products (sku, name, price, currency)
VALUES
  ('SKU-001', 'Wireless Mouse', 799.00, 'INR'),
  ('SKU-002', 'Mechanical Keyboard', 2499.00, 'INR'),
  ('SKU-003', 'USB-C Hub', 1599.00, 'INR')
ON CONFLICT (sku) DO NOTHING;

-- Initial stock.
INSERT INTO inventory_stock (product_id, on_hand, reserved)
SELECT
  id,
  CASE sku
    WHEN 'SKU-001' THEN 10
    WHEN 'SKU-002' THEN 5
    WHEN 'SKU-003' THEN 3
  END,
  0
FROM products
WHERE sku IN ('SKU-001', 'SKU-002', 'SKU-003')
ON CONFLICT (product_id) DO NOTHING;