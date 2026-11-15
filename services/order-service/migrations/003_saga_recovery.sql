CREATE INDEX IF NOT EXISTS idx_orders_pending_updated_at
ON orders(updated_at)
WHERE status = 'PENDING';
