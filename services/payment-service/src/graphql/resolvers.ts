import {
  findPayment,
  findPaymentsByOrderId,
  processOrderPayment
} from '../services/payment.service.js';

function mapPayment(payment: any) {
  if (!payment) return null;

  return {
    id: payment.id,
    orderId: payment.order_id,
    amount: Number(payment.amount),
    currency: payment.currency.trim(),
    status: payment.status,
    failureReason: payment.failure_reason,
    createdAt: new Date(payment.created_at).toISOString()
  };
}

export const resolvers = {
  Query: {
    payment: async (_: unknown, { id }: { id: string }) =>
      mapPayment(await findPayment(id)),

    paymentsByOrderId: async (
      _: unknown,
      { orderId }: { orderId: string }
    ) => {
      const payments = await findPaymentsByOrderId(orderId);
      return payments.map(mapPayment);
    }
  },

  Mutation: {
    processPayment: async (
      _: unknown,
      args: {
        orderId: string;
        idempotencyKey: string;
        amount: number;
        currency: string;
      }
    ) => mapPayment(await processOrderPayment(args))
  }
};
