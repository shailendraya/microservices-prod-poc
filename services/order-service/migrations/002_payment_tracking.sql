ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_id UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS valid_payment_status;

ALTER TABLE orders
  ADD CONSTRAINT valid_payment_status
  CHECK (
    payment_status IS NULL
    OR payment_status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')
  );

CREATE INDEX IF NOT EXISTS idx_orders_payment_status
ON orders(payment_status);
