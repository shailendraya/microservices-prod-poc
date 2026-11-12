import {
  getProducts,
  getProduct,
  getReservation,
  reserveStock as reserveStockRepository,
  changeReservationStatus,
  ReservationItemInput
} from '../repositories/inventory.repository.js';

export async function listProducts() {
  return getProducts();
}

export async function findProduct(sku: string) {
  return getProduct(sku.trim().toUpperCase());
}

export async function findReservation(id: string) {
  return getReservation(id);
}

export async function reserveStock(
  items: ReservationItemInput[],
  idempotencyKey: string
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one reservation item is required');
  }

  if (!idempotencyKey?.trim()) {
    throw new Error('Idempotency key is required');
  }

  const normalizedItems = items.map((item) => ({
    sku: item.sku.trim().toUpperCase(),
    quantity: item.quantity
  }));

  if (
    normalizedItems.some(
      (item) =>
        !item.sku ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0
    )
  ) {
    throw new Error('SKU and positive integer quantity are required');
  }

  const uniqueSkus = new Set(normalizedItems.map((item) => item.sku));

  if (uniqueSkus.size !== normalizedItems.length) {
    throw new Error('Duplicate SKUs are not allowed in one reservation');
  }

  return reserveStockRepository(
    normalizedItems,
    idempotencyKey.trim()
  );
}

export async function confirmReservation(id: string) {
  return changeReservationStatus(id, 'CONFIRMED');
}

export async function releaseReservation(id: string) {
  return changeReservationStatus(id, 'RELEASED');
}