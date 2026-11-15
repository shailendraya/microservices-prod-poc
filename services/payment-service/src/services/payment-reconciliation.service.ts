import {
  findStaleProcessingPayments,
  updatePaymentStatus
} from '../repositories/payment.repository.js';

import {
  getPaymentStatus
} from './payment-provider.service.js';

export interface ReconciliationOptions {
  staleMs: number;
  batchSize: number;
}

export interface ReconciliationResult {
  scanned: number;
  reconciled: number;
  unresolved: number;
  errors: number;
}

export async function reconcileStalePayments(
  options: ReconciliationOptions
): Promise<ReconciliationResult> {
  const { staleMs, batchSize } = options;

  if (!Number.isFinite(staleMs) || staleMs <= 0) {
    throw new Error('staleMs must be greater than zero');
  }

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  const payments = await findStaleProcessingPayments(
    staleMs,
    batchSize
  );

  const result: ReconciliationResult = {
    scanned: payments.length,
    reconciled: 0,
    unresolved: 0,
    errors: 0
  };

  for (const payment of payments) {
    try {
      const providerResult = await getPaymentStatus(
        payment.idempotency_key
      );

      if (!providerResult) {
        result.unresolved++;

        console.warn(
          `[PAYMENT_RECONCILIATION] No provider transaction found. paymentId=${payment.id}`
        );

        continue;
      }

      if (providerResult.status === 'PENDING') {
        result.unresolved++;

        console.info(
          `[PAYMENT_RECONCILIATION] Provider transaction still pending. paymentId=${payment.id}`
        );

        continue;
      }

      const updatedPayment = await updatePaymentStatus(
        payment.id,
        providerResult.status,
        providerResult.failureReason,
        providerResult.transactionId
      );

      result.reconciled++;

      console.info(
        `[PAYMENT_RECONCILIATION] Payment reconciled. paymentId=${payment.id} status=${updatedPayment.status}`
      );
    } catch (error) {
      result.errors++;

      console.error(
        `[PAYMENT_RECONCILIATION] Failed to reconcile payment. paymentId=${payment.id}`,
        error
      );
    }
  }

  return result;
}
