import { expireReservations } from '../services/inventory.service.js';

function readPositiveInteger(
  name: string,
  fallback: number
): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function startInventoryExpiryWorker(): () => Promise<void> {
  const enabled =
    process.env.INVENTORY_EXPIRY_ENABLED?.toLowerCase() !== 'false';

  if (!enabled) {
    console.log('[INVENTORY_EXPIRY_WORKER] Disabled');

    return async () => {};
  }

  const intervalMs = readPositiveInteger(
    'INVENTORY_EXPIRY_INTERVAL_MS',
    30000
  );

  const batchSize = readPositiveInteger(
    'INVENTORY_EXPIRY_BATCH_SIZE',
    20
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  let activeRun: Promise<void> | null = null;

  async function runBatch(): Promise<void> {
    if (activeRun) {
      return activeRun;
    }

    const currentRun = (async () => {
      try {
        const result = await expireReservations(batchSize);

        console.info(
          '[INVENTORY_EXPIRY_WORKER] Batch completed',
          {
            scanned: result.scanned,
            released: result.released,
            skipped: result.skipped,
            errors: result.errors.length
          }
        );

        for (const error of result.errors) {
          console.error(
            '[INVENTORY_EXPIRY_WORKER] Reservation release failed',
            error
          );
        }
      } catch (error) {
        console.error(
          '[INVENTORY_EXPIRY_WORKER] Batch failed',
          error
        );
      }
    })();

    activeRun = currentRun;

    try {
      await currentRun;
    } finally {
      if (activeRun === currentRun) {
        activeRun = null;
      }
    }
  }

  console.log('[INVENTORY_EXPIRY_WORKER] Started', {
    enabled,
    intervalMs,
    batchSize
  });

  // Run once immediately after startup.
  void runBatch();

  // Run periodically.
  timer = setInterval(() => {
    void runBatch();
  }, intervalMs);

  return async function stopInventoryExpiryWorker(): Promise<void> {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    if (activeRun) {
      await activeRun;
    }

    console.log('[INVENTORY_EXPIRY_WORKER] Stopped');
  };
}