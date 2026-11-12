import { GraphQLError } from 'graphql';

import {
  createOrder,
  findOrder,
  listOrders
} from '../services/order.service.js';

function handleError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : 'Internal server error';

  const code = (error as Error & { code?: string }).code;

  if (code === 'INSUFFICIENT_STOCK') {
    throw new GraphQLError(message, {
      extensions: { code: 'INSUFFICIENT_STOCK' }
    });
  }

  if (code === 'NOT_FOUND' || /user not found|product not found/i.test(message)) {
    throw new GraphQLError(message, {
      extensions: { code: 'NOT_FOUND' }
    });
  }

  if (
    code === 'CONFLICT' ||
    /idempotency key reused/i.test(message)
  ) {
    throw new GraphQLError(message, {
      extensions: { code: 'CONFLICT' }
    });
  }

  if (
    /required|positive integer|at least one|duplicate SKU|same currency/i.test(message)
  ) {
    throw new GraphQLError(message, {
      extensions: { code: 'BAD_USER_INPUT' }
    });
  }

  throw new GraphQLError(message, {
    extensions: { code: 'INTERNAL_SERVER_ERROR' }
  });
}

export const resolvers = {
  Query: {
    order: async (_: unknown, args: { id: string }) => {
      try {
        return await findOrder(args.id);
      } catch (error) {
        handleError(error);
      }
    },

    orders: async (_: unknown, args: { userId: string }) => {
      try {
        return await listOrders(args.userId);
      } catch (error) {
        handleError(error);
      }
    }
  },

  Mutation: {
    createOrder: async (
      _: unknown,
      args: {
        userId: string;
        idempotencyKey: string;
        items: Array<{ sku: string; quantity: number }>;
      }
    ) => {
      try {
        return await createOrder(args);
      } catch (error) {
        handleError(error);
      }
    }
  }
};
