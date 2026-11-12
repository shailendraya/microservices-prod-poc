ALTER TABLE payments
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE payments
DROP CONSTRAINT IF EXISTS valid_payment_status;

ALTER TABLE payments
ADD CONSTRAINT valid_payment_status
CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'));

CREATE INDEX IF NOT EXISTS idx_payments_processing_started_at
ON payments(processing_started_at)
WHERE status = 'PROCESSING';
