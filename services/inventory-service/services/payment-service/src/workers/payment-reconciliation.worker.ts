import {
  reconcileStalePayments
} from '../services/payment-reconciliation.service.js';

export interface PaymentReconciliationWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  staleMs: number;
  batchSize: number;
}

const DEFAULT_OPTIONS: PaymentReconciliationWorkerOptions = {
  enabled: true,
  intervalMs: 30000,
  staleMs: 120000,
  batchSize: 20
};

function validateOptions(
  options: PaymentReconciliationWorkerOptions
): void {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('intervalMs must be greater than zero');
  }

  if (!Number.isFinite(options.staleMs) || options.staleMs <= 0) {
    throw new Error('staleMs must be greater than zero');
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }
}

export function startPaymentReconciliationWorker(
  overrides: Partial<PaymentReconciliationWorkerOptions> = {}
) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...overrides
  };

  validateOptions(options);

  if (!options.enabled) {
    console.info('[PAYMENT_RECONCILIATION_WORKER] Disabled');

    return {
      stop: async () => {}
    };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let activeRun: Promise<void> | null = null;

  async function runOnce(): Promise<void> {
    if (stopped || activeRun) {
      return;
    }

    activeRun = (async () => {
      try {
        const result = await reconcileStalePayments({
          staleMs: options.staleMs,
          batchSize: options.batchSize
        });

        if (result.scanned > 0) {
          console.info(
            '[PAYMENT_RECONCILIATION_WORKER] Batch completed',
            result
          );
        }
      } catch (error) {
        console.error(
          '[PAYMENT_RECONCILIATION_WORKER] Batch failed',
          error
        );
      }
    })();

    try {
      await activeRun;
    } finally {
      activeRun = null;
    }
  }

  console.info(
    '[PAYMENT_RECONCILIATION_WORKER] Started',
    options
  );

  void runOnce();

  timer = setInterval(() => {
    void runOnce();
  }, options.intervalMs);

  return {
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }

      stopped = true;

      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }

      if (activeRun) {
        await activeRun;
      }

      console.info('[PAYMENT_RECONCILIATION_WORKER] Stopped');
    }
  };
}
