import { getStalePendingOrderIds } from '../repositories/order.repository.js';
import { resumeOrderSaga } from '../services/order.service.js';

export interface OrderRecoveryWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  staleMs: number;
  batchSize: number;
}

export function startOrderRecoveryWorker(
  options: OrderRecoveryWorkerOptions
): { stop: () => Promise<void> } {
  const {
    enabled,
    intervalMs,
    staleMs,
    batchSize
  } = options;

  if (!enabled) {
    console.log('[ORDER_RECOVERY_WORKER] Disabled');

    return {
      stop: async () => {}
    };
  }

  if (
    !Number.isInteger(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isInteger(staleMs) ||
    staleMs <= 0 ||
    !Number.isInteger(batchSize) ||
    batchSize <= 0
  ) {
    throw new Error('Invalid Order Recovery Worker configuration');
  }

  let activeRun: Promise<void> | null = null;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    if (stopped || activeRun) {
      return;
    }

    const currentRun = (async () => {
      let scanned = 0;
      let attempted = 0;
      let errors = 0;

      try {
        const orderIds = await getStalePendingOrderIds(
          staleMs,
          batchSize
        );

        scanned = orderIds.length;

        for (const orderId of orderIds) {
          if (stopped) {
            break;
          }

          attempted++;

          try {
            await resumeOrderSaga(orderId);

            console.log(
              `[ORDER_RECOVERY] Saga resumed. orderId=${orderId}`
            );
          } catch (error) {
            errors++;

            console.error(
              `[ORDER_RECOVERY] Failed to resume Saga. orderId=${orderId}`,
              error
            );
          }
        }

        if (scanned > 0 || errors > 0) {
          console.log('[ORDER_RECOVERY_WORKER] Batch completed', {
            scanned,
            attempted,
            errors
          });
        }
      } catch (error) {
        console.error(
          '[ORDER_RECOVERY_WORKER] Batch execution failed',
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
  };

  console.log('[ORDER_RECOVERY_WORKER] Started', {
    enabled,
    intervalMs,
    staleMs,
    batchSize
  });

  // Run once immediately when the worker starts.
  void runOnce();

  const interval = setInterval(() => {
    void runOnce();
  }, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(interval);

      if (activeRun) {
        await activeRun;
      }

      console.log('[ORDER_RECOVERY_WORKER] Stopped');
    }
  };
}
