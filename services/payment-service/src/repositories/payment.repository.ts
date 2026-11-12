import { pool } from '../config/database.js';

export interface PaymentInput {
  orderId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
}

export async function createPayment(input: PaymentInput) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Serialize requests using the same idempotency key.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [input.idempotencyKey]
    );

    const existing = await client.query(
      `SELECT *
       FROM payments
       WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const payment = existing.rows[0];

      if (
        payment.order_id !== input.orderId ||
        Number(payment.amount) !== input.amount ||
        payment.currency.trim() !== input.currency
      ) {
        throw new Error(
          'Idempotency key reused with different payment details'
        );
      }

      await client.query('COMMIT');
      transactionStarted = false;

      return payment;
    }

    const result = await client.query(
      `INSERT INTO payments (
        order_id,
        idempotency_key,
        amount,
        currency
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [
        input.orderId,
        input.idempotencyKey,
        input.amount,
        input.currency
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return result.rows[0];
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Atomically claims a payment for processing.
 *
 * A PROCESSING record cannot be reclaimed automatically.
 * Stuck PROCESSING payments require provider reconciliation.
 */
export async function claimPaymentProcessing(paymentId: string) {
  const result = await pool.query(
    `UPDATE payments
     SET status = 'PROCESSING',
         processing_started_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PENDING'
     RETURNING *`,
    [paymentId]
  );

  if (result.rows.length > 0) {
    return {
      claimed: true,
      payment: result.rows[0]
    };
  }

  const existing = await getPayment(paymentId);

  if (!existing) {
    throw new Error('Payment not found');
  }

  return {
    claimed: false,
    payment: existing
  };
}

/**
 * Updates the payment only when it is currently PROCESSING.
 * Also stores the provider transaction reference.
 */
export async function updatePaymentStatus(
  paymentId: string,
  status: 'SUCCESS' | 'FAILED',
  failureReason: string | null = null,
  providerTransactionId: string | null = null
) {
  const result = await pool.query(
    `UPDATE payments
     SET status = $2,
         failure_reason = $3,
         provider_transaction_id =
           COALESCE($4::UUID, provider_transaction_id),
         processing_started_at = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PROCESSING'
     RETURNING *`,
    [
      paymentId,
      status,
      failureReason,
      providerTransactionId
    ]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const existing = await getPayment(paymentId);

  if (!existing) {
    throw new Error('Payment not found');
  }

  // Do not silently overwrite an already completed payment.
  if (existing.status !== status) {
    throw new Error(
      `Cannot change payment status from ${existing.status} to ${status}`
    );
  }

  return existing;
}

/**
 * Finds payments that have remained PROCESSING beyond staleMs.
 * This function only reads records; it never initiates payments.
 */
export async function findStaleProcessingPayments(
  staleMs = 120000,
  limit = 50
) {
  if (!Number.isFinite(staleMs) || staleMs <= 0) {
    throw new Error('staleMs must be greater than zero');
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive integer');
  }

  const result = await pool.query(
    `SELECT *
     FROM payments
     WHERE status = 'PROCESSING'
       AND processing_started_at IS NOT NULL
       AND processing_started_at <
           NOW() - ($1 * INTERVAL '1 millisecond')
     ORDER BY processing_started_at ASC
     LIMIT $2`,
    [staleMs, limit]
  );

  return result.rows;
}

export async function getPayment(paymentId: string) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE id = $1',
    [paymentId]
  );

  return result.rows[0] ?? null;
}

export async function getPaymentsByOrderId(orderId: string) {
  const result = await pool.query(
    `SELECT *
     FROM payments
     WHERE order_id = $1
     ORDER BY created_at DESC`,
    [orderId]
  );

  return result.rows;
}
