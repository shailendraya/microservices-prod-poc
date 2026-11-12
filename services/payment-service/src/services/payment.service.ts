import {
  createPayment,
  claimPaymentProcessing,
  getPayment,
  getPaymentsByOrderId,
  updatePaymentStatus
} from '../repositories/payment.repository.js';

import { processPayment } from './payment-provider.service.js';

interface ProcessPaymentInput {
  orderId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
}

export async function processOrderPayment(
  input: ProcessPaymentInput
) {
  if (!input.orderId || !input.idempotencyKey) {
    throw new Error('Order ID and idempotency key are required');
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  if (!input.currency || input.currency.length !== 3) {
    throw new Error('Valid currency is required');
  }

  const payment = await createPayment(input);

  if (
    payment.status === 'SUCCESS' ||
    payment.status === 'FAILED'
  ) {
    return payment;
  }

  const claim = await claimPaymentProcessing(payment.id);

  // Another request owns this payment, or it is already complete.
  if (!claim.claimed) {
    return claim.payment;
  }

  // Always reuse the same key when calling a real payment provider.
  const providerResult = await processPayment(
    Number(claim.payment.amount),
    claim.payment.idempotency_key,
    claim.payment.currency.trim()
  );

  // Provider has not reached a final outcome.
  // Keep the payment in PROCESSING for reconciliation.
  if (providerResult.status === 'PENDING') {
    return claim.payment;
  }

  // Only SUCCESS or FAILED can reach this update.
  return updatePaymentStatus(
  claim.payment.id,
  providerResult.status,
  providerResult.failureReason,
  providerResult.transactionId
);
}

export async function findPayment(paymentId: string) {
  return getPayment(paymentId);
}

export async function findPaymentsByOrderId(orderId: string) {
  return getPaymentsByOrderId(orderId);
}
