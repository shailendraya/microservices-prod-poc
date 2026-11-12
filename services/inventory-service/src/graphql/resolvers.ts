import { GraphQLError } from 'graphql';

import {
  listProducts,
  findProduct,
  findReservation,
  reserveStock,
  confirmReservation,
  releaseReservation
} from '../services/inventory.service.js';

function handleError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : 'Internal server error';

  let code = 'INTERNAL_SERVER_ERROR';

  if (/not found/i.test(message)) {
    code = 'NOT_FOUND';
  } else if (/insufficient stock/i.test(message)) {
    code = 'INSUFFICIENT_STOCK';
  } else if (
    /cannot change|idempotency key reused|consistency error/i.test(message)
  ) {
    code = 'CONFLICT';
  } else if (
    /required|positive integer|duplicate SKU|at least one/i.test(message)
  ) {
    code = 'BAD_USER_INPUT';
  }

  throw new GraphQLError(message, {
    extensions: { code }
  });
}

export const resolvers = {
  Query: {
    products: () => listProducts(),

    product: (_: unknown, args: { sku: string }) =>
      findProduct(args.sku),

    reservation: async (_: unknown, args: { id: string }) => {
      const reservation = await findReservation(args.id);

      if (!reservation) {
        throw new GraphQLError('Reservation not found', {
          extensions: { code: 'NOT_FOUND' }
        });
      }

      return reservation;
    }
  },

  Mutation: {
    reserveStock: async (_: unknown, args: any) => {
      try {
        return await reserveStock(
          args.items,
          args.idempotencyKey
        );
      } catch (error) {
        handleError(error);
      }
    },

    confirmReservation: async (_: unknown, args: { id: string }) => {
      try {
        return await confirmReservation(args.id);
      } catch (error) {
        handleError(error);
      }
    },

    releaseReservation: async (_: unknown, args: { id: string }) => {
      try {
        return await releaseReservation(args.id);
      } catch (error) {
        handleError(error);
      }
    }
  }
};