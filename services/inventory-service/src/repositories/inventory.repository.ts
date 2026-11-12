import { PoolClient } from 'pg';
import { pool } from '../config/database.js';

export interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface ReservationItemInput {
  sku: string;
  quantity: number;
}

export interface Reservation {
  id: string;
  idempotencyKey: string;
  status: string;
  expiresAt: string;
  items: {
    sku: string;
    quantity: number;
  }[];
}

function mapProduct(row: any): Product {
  return {
    id: String(row.id),
    sku: row.sku,
    name: row.name,
    price: Number(row.price),
    currency: row.currency,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: row.on_hand - row.reserved
  };
}

export async function getProducts(): Promise<Product[]> {
  const result = await pool.query(`
    SELECT
      p.id,
      p.sku,
      p.name,
      p.price,
      p.currency,
      s.on_hand,
      s.reserved
    FROM products p
    JOIN inventory_stock s ON s.product_id = p.id
    ORDER BY p.id
  `);

  return result.rows.map(mapProduct);
}

export async function getProduct(sku: string): Promise<Product | null> {
  const result = await pool.query(
    `SELECT
       p.id, p.sku, p.name, p.price, p.currency,
       s.on_hand, s.reserved
     FROM products p
     JOIN inventory_stock s ON s.product_id = p.id
     WHERE p.sku = $1`,
    [sku]
  );

  return result.rows[0] ? mapProduct(result.rows[0]) : null;
}

async function getReservationWithClient(
  client: PoolClient,
  id: string
): Promise<Reservation | null> {
  const result = await client.query(
    `SELECT
       r.id,
       r.idempotency_key,
       r.status,
       r.expires_at,
       p.sku,
       ri.quantity
     FROM reservations r
     LEFT JOIN reservation_items ri ON ri.reservation_id = r.id
     LEFT JOIN products p ON p.id = ri.product_id
     WHERE r.id = $1
     ORDER BY p.sku`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const first = result.rows[0];

  return {
    id: String(first.id),
    idempotencyKey: first.idempotency_key,
    status: first.status,
    expiresAt: new Date(first.expires_at).toISOString(),
    items: result.rows
      .filter((row) => row.sku !== null)
      .map((row) => ({
        sku: row.sku,
        quantity: row.quantity
      }))
  };
}

export async function getReservation(
  id: string
): Promise<Reservation | null> {
  const client = await pool.connect();

  try {
    return await getReservationWithClient(client, id);
  } finally {
    client.release();
  }
}

export async function reserveStock(
  items: ReservationItemInput[],
  idempotencyKey: string
): Promise<Reservation> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Serialize requests using the same idempotency key.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [idempotencyKey]
    );

    const existing = await client.query(
      'SELECT id FROM reservations WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const reservation = await getReservationWithClient(
        client,
        existing.rows[0].id
      );

      const previousItems = reservation!.items
        .map((item) => `${item.sku}:${item.quantity}`)
        .sort();

      const requestedItems = items
        .map((item) => `${item.sku}:${item.quantity}`)
        .sort();

      if (JSON.stringify(previousItems) !== JSON.stringify(requestedItems)) {
        throw new Error('Idempotency key reused with different items');
      }

      await client.query('COMMIT');
      transactionStarted = false;

      return reservation!;
    }

    const skus = items.map((item) => item.sku);

    // Lock stock rows in deterministic order.
    const stockResult = await client.query(
      `SELECT
         p.id,
         p.sku,
         s.on_hand,
         s.reserved
       FROM products p
       JOIN inventory_stock s ON s.product_id = p.id
       WHERE p.sku = ANY($1::text[])
       ORDER BY p.sku
       FOR UPDATE OF s`,
      [skus]
    );

    const stockBySku = new Map(
      stockResult.rows.map((row) => [row.sku, row])
    );

    for (const item of items) {
      const stock = stockBySku.get(item.sku);

      if (!stock) {
        throw new Error(`Product not found: ${item.sku}`);
      }

      const available = stock.on_hand - stock.reserved;

      if (available < item.quantity) {
        throw new Error(`Insufficient stock for SKU: ${item.sku}`);
      }
    }

    const reservationResult = await client.query(
      `INSERT INTO reservations
        (idempotency_key, status, expires_at)
       VALUES ($1, 'RESERVED', NOW() + INTERVAL '15 minutes')
       RETURNING id`,
      [idempotencyKey]
    );

    const reservationId = reservationResult.rows[0].id;

    for (const item of items) {
      const stock = stockBySku.get(item.sku);

      await client.query(
        `UPDATE inventory_stock
         SET reserved = reserved + $2
         WHERE product_id = $1`,
        [stock.id, item.quantity]
      );

      await client.query(
        `INSERT INTO reservation_items
          (reservation_id, product_id, quantity)
         VALUES ($1, $2, $3)`,
        [reservationId, stock.id, item.quantity]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    const reservation = await getReservation(reservationId);

    if (!reservation) {
      throw new Error('Reservation could not be retrieved');
    }

    return reservation;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function changeReservationStatus(
  id: string,
  nextStatus: 'CONFIRMED' | 'RELEASED'
): Promise<Reservation> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const result = await client.query(
      'SELECT status FROM reservations WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error('Reservation not found');
    }

    const currentStatus = result.rows[0].status;

    if (currentStatus === nextStatus) {
      await client.query('COMMIT');
      transactionStarted = false;

      return (await getReservation(id))!;
    }

    if (currentStatus !== 'RESERVED') {
      throw new Error(
        `Cannot change reservation status from ${currentStatus} to ${nextStatus}`
      );
    }

    const items = await client.query(
      `SELECT product_id, quantity
       FROM reservation_items
       WHERE reservation_id = $1`,
      [id]
    );

    for (const item of items.rows) {
      const updateQuery =
        nextStatus === 'CONFIRMED'
          ? `UPDATE inventory_stock
             SET reserved = reserved - $2,
                 on_hand = on_hand - $2
             WHERE product_id = $1
               AND reserved >= $2
               AND on_hand >= $2`
          : `UPDATE inventory_stock
             SET reserved = reserved - $2
             WHERE product_id = $1
               AND reserved >= $2`;

      const updateResult = await client.query(updateQuery, [
        item.product_id,
        item.quantity
      ]);

      if (updateResult.rowCount !== 1) {
        throw new Error('Inventory stock consistency error');
      }
    }

    await client.query(
      'UPDATE reservations SET status = $2 WHERE id = $1',
      [id, nextStatus]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return (await getReservation(id))!;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}