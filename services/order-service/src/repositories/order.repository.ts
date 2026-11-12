import type { PoolClient } from 'pg';
import { pool } from '../config/database.js';

export interface OrderItemInput {
  sku: string;
  productName: string;
  unitPrice: number;
  currency: string;
  quantity: number;
}

export interface OrderItem extends OrderItemInput {
  lineTotal: number;
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';
export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED';

export interface Order {
  id: string;
  userId: string;
  idempotencyKey: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  inventoryReservationId: string | null;
  paymentId: string | null;
  paymentStatus: PaymentStatus | null;
  failureReason: string | null;
  createdAt: string;
  items: OrderItem[];
}

interface OrderRow {
  id: string;
  user_id: string;
  idempotency_key: string;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  inventory_reservation_id: string | null;
  payment_id: string | null;
  payment_status: PaymentStatus | null;
  failure_reason: string | null;
  created_at: Date;
}

interface OrderItemRow {
  sku: string;
  product_name: string;
  unit_price: string;
  currency: string;
  quantity: number;
  line_total: string;
}

function mapOrder(row: OrderRow, items: OrderItemRow[]): Order {
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    totalAmount: Number(row.total_amount),
    currency: row.currency.trim(),
    inventoryReservationId: row.inventory_reservation_id,
    paymentId: row.payment_id,
    paymentStatus: row.payment_status,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    items: items.map(item => ({
      sku: item.sku,
      productName: item.product_name,
      unitPrice: Number(item.unit_price),
      currency: item.currency.trim(),
      quantity: item.quantity,
      lineTotal: Number(item.line_total)
    }))
  };
}

async function getOrderWithClient(
  client: PoolClient,
  orderId: string
): Promise<Order | null> {
  const orderResult = await client.query<OrderRow>(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );

  if (!orderResult.rows[0]) return null;

  const itemResult = await client.query<OrderItemRow>(
    `SELECT sku, product_name, unit_price, currency, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  return mapOrder(orderResult.rows[0], itemResult.rows);
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const client = await pool.connect();

  try {
    return await getOrderWithClient(client, orderId);
  } finally {
    client.release();
  }
}

export async function getOrdersByUserId(
  userId: string
): Promise<Order[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const orders = await Promise.all(
    result.rows.map(row => getOrder(row.id))
  );

  return orders.filter((order): order is Order => order !== null);
}

export async function createPendingOrder(input: {
  userId: string;
  idempotencyKey: string;
  currency: string;
  totalAmount: number;
  items: OrderItem[];
}): Promise<Order> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Serialize requests using the same order idempotency key.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [input.idempotencyKey]
    );

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO orders (
        user_id, idempotency_key, total_amount, currency
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`,
      [
        input.userId,
        input.idempotencyKey,
        input.totalAmount,
        input.currency
      ]
    );

    let orderId: string;

    if (insertResult.rows[0]) {
      orderId = insertResult.rows[0].id;

      for (const item of input.items) {
        await client.query(
          `INSERT INTO order_items (
            order_id, sku, product_name, unit_price,
            currency, quantity, line_total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            item.sku,
            item.productName,
            item.unitPrice,
            item.currency,
            item.quantity,
            item.lineTotal
          ]
        );
      }
    } else {
      const existing = await client.query<OrderRow>(
        'SELECT * FROM orders WHERE idempotency_key = $1 FOR UPDATE',
        [input.idempotencyKey]
      );

      const row = existing.rows[0];

      if (!row) {
        throw new Error('Unable to retrieve existing order');
      }

      orderId = row.id;

      const existingItems = await client.query<OrderItemRow>(
        `SELECT sku, quantity
         FROM order_items
         WHERE order_id = $1
         ORDER BY sku`,
        [orderId]
      );

      const existingPayload = existingItems.rows.map(item => ({
        sku: item.sku,
        quantity: item.quantity
      }));

      const requestedPayload = input.items
        .map(item => ({ sku: item.sku, quantity: item.quantity }))
        .sort((a, b) => a.sku.localeCompare(b.sku));

      if (
        row.user_id !== input.userId ||
        JSON.stringify(existingPayload) !== JSON.stringify(requestedPayload)
      ) {
        throw new Error(
          'Idempotency key reused with different order details'
        );
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;

    const order = await getOrder(orderId);

    if (!order) {
      throw new Error('Order not found after creation');
    }

    return order;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function attachInventoryReservation(
  orderId: string,
  reservationId: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE orders
     SET inventory_reservation_id = $2,
         updated_at = NOW()
     WHERE id = $1
       AND (
         inventory_reservation_id IS NULL
         OR inventory_reservation_id = $2
       )`,
    [orderId, reservationId]
  );

  if (result.rowCount !== 1) {
    throw new Error('Unable to attach inventory reservation to order');
  }
}

export async function attachPayment(
  orderId: string,
  paymentId: string,
  paymentStatus: PaymentStatus
): Promise<void> {
  const result = await pool.query(
    `UPDATE orders
     SET payment_id = COALESCE(payment_id, $2),
         payment_status = CASE
           WHEN payment_status IN ('SUCCESS', 'FAILED')
             THEN payment_status
           ELSE $3
         END,
         updated_at = NOW()
     WHERE id = $1
       AND (payment_id IS NULL OR payment_id = $2)`,
    [orderId, paymentId, paymentStatus]
  );

  if (result.rowCount !== 1) {
    throw new Error('Unable to attach payment to order');
  }
}

export async function markOrderConfirmed(
  orderId: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE orders
     SET status = 'CONFIRMED',
         failure_reason = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PENDING'
       AND payment_status = 'SUCCESS'`,
    [orderId]
  );

  if (result.rowCount === 1) return;

  const order = await getOrder(orderId);

  if (order?.status !== 'CONFIRMED') {
    throw new Error(
      'Unable to confirm order: payment must be successful'
    );
  }
}

export async function markOrderFailed(
  orderId: string,
  reason: string
): Promise<void> {
  const result = await pool.query(
    `UPDATE orders
     SET status = 'FAILED',
         failure_reason = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'PENDING'
       AND (
         payment_status IS NULL
         OR payment_status = 'FAILED'
       )`,
    [orderId, reason]
  );

  if (result.rowCount === 1) return;

  const order = await getOrder(orderId);

  if (order?.status !== 'FAILED') {
    throw new Error(
      'Unable to fail order: payment is not confirmed as failed'
    );
  }
}
