import 'dotenv/config';

import {
  attachInventoryReservation,
  attachPayment,
  createPendingOrder,
  getOrder,
  getOrdersByUserId,
  markOrderConfirmed,
  markOrderFailed,
  type Order,
  type OrderItem,
  type PaymentStatus
} from '../repositories/order.repository.js';

const INVENTORY_URL =
  process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002/graphql';

const USER_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001/graphql';

const PAYMENT_URL =
  process.env.PAYMENT_SERVICE_URL || 'http://localhost:4004/graphql';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: { code?: string };
  }>;
}

async function graphqlRequest<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`Service returned HTTP ${response.status}`);
  }

  const result = await response.json() as GraphQLResponse<T>;

  if (result.errors?.length) {
    const error = new Error(result.errors[0].message) as Error & {
      code?: string;
    };

    error.code = result.errors[0].extensions?.code;
    throw error;
  }

  if (!result.data) {
    throw new Error('Service returned an empty GraphQL response');
  }

  return result.data;
}

interface UserResponse {
  user: { id: string } | null;
}

interface Product {
  sku: string;
  name: string;
  price: number;
  currency: string;
  available: number;
}

interface ProductsResponse {
  products: Product[];
}

interface ReservationResponse {
  reserveStock: {
    id: string;
    status: string;
  };
}

interface ReservationStatusResponse {
  confirmReservation: {
    id: string;
    status: string;
  };
}

interface ReleaseReservationResponse {
  releaseReservation: {
    id: string;
    status: string;
  };
}

interface PaymentResponse {
  processPayment: {
    id: string;
    orderId: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    failureReason: string | null;
  };
}

interface CreateOrderInput {
  userId: string;
  idempotencyKey: string;
  items: Array<{
    sku: string;
    quantity: number;
  }>;
}

async function validateUser(userId: string): Promise<void> {
  const query = `
    query($id: ID!) {
      user(id: $id) {
        id
      }
    }
  `;

  const data = await graphqlRequest<UserResponse>(
    USER_URL,
    query,
    { id: userId }
  );

  if (!data.user) {
    throw new Error('User not found');
  }
}

async function reserveInventory(
  order: Order,
  items: Array<{ sku: string; quantity: number }>
): Promise<Order> {
  if (order.inventoryReservationId) {
    return order;
  }

  const query = `
    mutation($key: String!, $items: [ReservationItemInput!]!) {
      reserveStock(idempotencyKey: $key, items: $items) {
        id
        status
      }
    }
  `;

  const data = await graphqlRequest<ReservationResponse>(
    INVENTORY_URL,
    query,
    {
      key: `order-${order.id}`,
      items
    }
  );

  await attachInventoryReservation(
    order.id,
    data.reserveStock.id
  );

  const updatedOrder = await getOrder(order.id);

  if (!updatedOrder) {
    throw new Error('Order not found after inventory reservation');
  }

  return updatedOrder;
}

async function processPaymentForOrder(order: Order) {
  const query = `
    mutation(
      $orderId: ID!,
      $key: String!,
      $amount: Float!,
      $currency: String!
    ) {
      processPayment(
        orderId: $orderId,
        idempotencyKey: $key,
        amount: $amount,
        currency: $currency
      ) {
        id
        orderId
        amount
        currency
        status
        failureReason
      }
    }
  `;

  return graphqlRequest<PaymentResponse>(
    PAYMENT_URL,
    query,
    {
      orderId: order.id,
      key: `order-${order.id}`,
      amount: order.totalAmount,
      currency: order.currency
    }
  );
}

async function confirmInventory(order: Order): Promise<void> {
  if (!order.inventoryReservationId) {
    throw new Error('Order has no inventory reservation');
  }

  const query = `
    mutation($id: ID!) {
      confirmReservation(id: $id) {
        id
        status
      }
    }
  `;

  await graphqlRequest<ReservationStatusResponse>(
    INVENTORY_URL,
    query,
    { id: order.inventoryReservationId }
  );
}

async function releaseInventory(order: Order): Promise<void> {
  if (!order.inventoryReservationId) {
    throw new Error('Order has no inventory reservation to release');
  }

  const query = `
    mutation($id: ID!) {
      releaseReservation(id: $id) {
        id
        status
      }
    }
  `;

  await graphqlRequest<ReleaseReservationResponse>(
    INVENTORY_URL,
    query,
    { id: order.inventoryReservationId }
  );
}

async function getRequiredOrder(orderId: string): Promise<Order> {
  const order = await getOrder(orderId);

  if (!order) {
    throw new Error('Order not found');
  }

  return order;
}

/**
 * Resume the Saga from its persisted state.
 *
 * Repeating this function with the same order ID is safe:
 * - Inventory uses order-{orderId} as its reservation key.
 * - Payment uses order-{orderId} as its payment key.
 * - Inventory confirmation and release are idempotent.
 */
async function continueOrderSaga(initialOrder: Order): Promise<Order> {
  let order = initialOrder;

  if (order.status === 'CONFIRMED' || order.status === 'FAILED') {
    return order;
  }

  // Step 1: Reserve inventory if it has not been reserved yet.
  if (!order.inventoryReservationId) {
    try {
      order = await reserveInventory(order, order.items.map(item => ({
        sku: item.sku,
        quantity: item.quantity
      })));
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      const message =
        error instanceof Error ? error.message : 'Inventory error';

      if (
        ['INSUFFICIENT_STOCK', 'NOT_FOUND', 'BAD_USER_INPUT', 'CONFLICT']
          .includes(code || '')
      ) {
        await markOrderFailed(order.id, message);
        return getRequiredOrder(order.id);
      }

      // Unknown outcome: keep order PENDING.
      throw new Error(
        `Order is pending; inventory outcome is unknown. Retry using the same idempotency key. Details: ${message}`
      );
    }
  }

  // Step 2: If a previous attempt recorded payment failure,
  // resume compensation rather than attempting another payment.
  if (order.paymentStatus === 'FAILED') {
    await releaseInventory(order);

    await markOrderFailed(
      order.id,
      'Payment declined. Reserved inventory released.'
    );

    return getRequiredOrder(order.id);
  }

  // Step 3: If payment already succeeded, resume inventory confirmation.
  if (order.paymentStatus === 'SUCCESS') {
    await confirmInventory(order);
    await markOrderConfirmed(order.id);

    return getRequiredOrder(order.id);
  }

  // Step 4: Process or retrieve the existing payment.
  const paymentData = await processPaymentForOrder(order);
  const payment = paymentData.processPayment;

  if (payment.orderId !== order.id) {
    throw new Error('Payment service returned a different order ID');
  }

  await attachPayment(order.id, payment.id, payment.status);

  order = await getRequiredOrder(order.id);

  // Another request may have completed the Saga while this request ran.
  if (order.status === 'CONFIRMED' || order.status === 'FAILED') {
    return order;
  }

  if (payment.status === 'PENDING' || payment.status === 'PROCESSING') {
    // Payment is not final. Keep the order PENDING.
    return order;
  }

  // Step 5: Payment failed. Compensate by releasing inventory.
  if (payment.status === 'FAILED') {
    await releaseInventory(order);

    await markOrderFailed(
      order.id,
      payment.failureReason || 'Payment failed. Reserved inventory released.'
    );

    return getRequiredOrder(order.id);
  }

  // Step 6: Payment succeeded. Confirm stock, then order.
  if (payment.status === 'SUCCESS') {
    await confirmInventory(order);
    await markOrderConfirmed(order.id);

    return getRequiredOrder(order.id);
  }

  throw new Error(`Unexpected payment status: ${payment.status}`);
}

export async function createOrder(
  input: CreateOrderInput
): Promise<Order> {
  if (!input.userId || !input.idempotencyKey) {
    throw new Error('User ID and idempotency key are required');
  }

  if (!input.items?.length) {
    throw new Error('At least one order item is required');
  }

  const normalizedItems = input.items.map(item => ({
    sku: item.sku.trim().toUpperCase(),
    quantity: item.quantity
  }));

  if (
    normalizedItems.some(
      item =>
        !item.sku ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0
    )
  ) {
    throw new Error('SKU and positive integer quantity are required');
  }

  if (
    new Set(normalizedItems.map(item => item.sku)).size !==
    normalizedItems.length
  ) {
    throw new Error('Duplicate SKU in order');
  }

  await validateUser(input.userId);

  const productQuery = `
    query {
      products {
        sku
        name
        price
        currency
        available
      }
    }
  `;

  const productData = await graphqlRequest<ProductsResponse>(
    INVENTORY_URL,
    productQuery,
    {}
  );

  const productMap = new Map(
    productData.products.map(product => [product.sku, product])
  );

  const orderItems: OrderItem[] = normalizedItems.map(item => {
    const product = productMap.get(item.sku);

    if (!product) {
      throw new Error(`Product not found: ${item.sku}`);
    }

    return {
      sku: product.sku,
      productName: product.name,
      unitPrice: product.price,
      currency: product.currency,
      quantity: item.quantity,
      lineTotal: Math.round(product.price * item.quantity * 100) / 100
    };
  });

  const currencies = new Set(orderItems.map(item => item.currency));

  if (currencies.size !== 1) {
    throw new Error('All products in an order must use the same currency');
  }

  const totalAmount = Math.round(
    orderItems.reduce((total, item) => total + item.lineTotal, 0) * 100
  ) / 100;

  const order = await createPendingOrder({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    currency: orderItems[0].currency,
    totalAmount,
    items: orderItems
  });

  return continueOrderSaga(order);
}

export async function findOrder(id: string) {
  return getOrder(id);
}

export async function listOrders(userId: string) {
  return getOrdersByUserId(userId);
}
