import { pool } from '../config/database.js';

export type ProviderPaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED';

export interface ProviderPaymentResult {
  transactionId: string;
  status: ProviderPaymentStatus;
  failureReason: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processPayment(
  amount: number,
  idempotencyKey: string,
  currency = 'INR'
): Promise<ProviderPaymentResult> {
  // Simulate external provider processing latency.
  await delay(500);

  // Check whether this idempotency key was already processed.
  const existing = await pool.query(
    `SELECT id, status, failure_reason
     FROM provider_transactions
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existing.rows.length > 0) {
    const transaction = existing.rows[0];

    return {
      transactionId: transaction.id,
      status: transaction.status,
      failureReason: transaction.failure_reason
    };
  }

  const isDeclined = Math.round(amount * 100) % 100 === 99;

  const status: ProviderPaymentStatus = isDeclined
    ? 'FAILED'
    : 'SUCCESS';

  const failureReason = isDeclined
    ? 'Simulated payment declined'
    : null;

  // Persist the provider transaction.
  // The unique idempotency key protects against duplicate records.
  const result = await pool.query(
    `INSERT INTO provider_transactions (
       idempotency_key,
       amount,
       currency,
       status,
       failure_reason
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key)
     DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, status, failure_reason`,
    [idempotencyKey, amount, currency, status, failureReason]
  );

  const transaction = result.rows[0];

  console.log(
    `[PAYMENT_PROVIDER_TRANSACTION] key=${idempotencyKey} status=${transaction.status}`
  );

  return {
    transactionId: transaction.id,
    status: transaction.status,
    failureReason: transaction.failure_reason
  };
}

/**
 * Reconciliation API:
 * Look up the provider's actual transaction using its idempotency key.
 *
 * This does NOT initiate another payment.
 */
export async function getPaymentStatus(
  idempotencyKey: string
): Promise<ProviderPaymentResult | null> {
  const result = await pool.query(
    `SELECT id, status, failure_reason
     FROM provider_transactions
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const transaction = result.rows[0];

  return {
    transactionId: transaction.id,
    status: transaction.status,
    failureReason: transaction.failure_reason
  };
}
