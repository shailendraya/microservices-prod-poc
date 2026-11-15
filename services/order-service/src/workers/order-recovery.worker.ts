import { getStalePendingOrderIds } from '../repositories/order.repository.js';
import { resumeOrderSaga } from '../services/order.service.js';

interface OrderRecoveryConfig {
  enabled: boolean;
  intervalMs: number;
  staleMs: number;
  batchSize: number;
}

function getConfig(): OrderRecoveryConfig {
  const config = {
    enabled: process.env.ORDER_RECOVERY_ENABLED !== 'false',
    intervalMs: Number(process.env.ORDER_RECOVERY_INTERVAL_MS || 30000),
    staleMs: Number(process.env.ORDER_RECOVERY_STALE_MS || 60000),
    batchSize: Number(process.env.ORDER_RECOVERY_BATCH_SIZE || 20)
  };

  if (
    !Number.isFinite(config.intervalMs) ||
    config.intervalMs <= 0 ||
    !Number.isFinite(config.staleMs) ||
    config.staleMs <= 0 ||
    !Number.isInteger(config.batchSize) ||
    config.batchSize <= 0
  ) {
    throw new Error('Invalid Order Recovery Worker configuration');
  }

  return config;
}

export function startOrderRecoveryWorker(): () => Promise<void> {
  const config = getConfig();

  if (!config.enabled) {
    console.log('[ORDER_RECOVERY_WORKER] Disabled');
    return async () => {};
  }

  let stopped = false;
  let activeRun: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const runBatch = async (): Promise<void> => {
    try {
      const orderIds = await getStalePendingOrderIds(
        config.staleMs,
        config.batchSize
      );

      let resumed = 0;
      let skipped = 0;
      let errors = 0;

      for (const orderId of orderIds) {
        if (stopped) break;

        try {
          const result = await resumeOrderSaga(orderId);

          if (result) {
            resumed++;

            console.log(
              `[ORDER_RECOVERY_WORKER] Order processed. orderId=${orderId} status=${result.status}`
            );
          } else {
            skipped++;
          }
        } catch (error) {
          errors++;

          console.error(
            `[ORDER_RECOVERY_WORKER] Order recovery failed. orderId=${orderId}`,
            error
          );
        }
      }

      console.log('[ORDER_RECOVERY_WORKER] Batch completed', {
        scanned: orderIds.length,
        resumed,
        skipped,
        errors
      });
    } catch (error) {
      console.error('[ORDER_RECOVERY_WORKER] Batch failed', error);
    }
  };

  const startRun = (): void => {
    if (stopped || activeRun) return;

    activeRun = runBatch().finally(() => {
      activeRun = null;
    });
  };

  console.log('[ORDER_RECOVERY_WORKER] Started', {
    enabled: true,
    intervalMs: config.intervalMs,
    staleMs: config.staleMs,
    batchSize: config.batchSize
  });

  // Run immediately when the worker starts.
  startRun();

  // Run periodically.
  timer = setInterval(startRun, config.intervalMs);

  return async (): Promise<void> => {
    stopped = true;

    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    // Wait for the currently running batch to finish.
    if (activeRun) {
      await activeRun;
    }

    console.log('[ORDER_RECOVERY_WORKER] Stopped');
  };
}
