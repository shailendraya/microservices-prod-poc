import 'dotenv/config';

import { createApp } from '../app.js';
import { pool } from './database.js';

import {
  startPaymentReconciliationWorker
} from '../workers/payment-reconciliation.worker.js';

const PORT = Number(process.env.PORT) || 4004;

function getBooleanEnv(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

async function startServer() {
  const app = await createApp();

  const server = app.listen(PORT, () => {
    console.log(
      `Payment Service running at http://localhost:${PORT}/graphql`
    );
  });

  const worker = startPaymentReconciliationWorker({
    enabled: getBooleanEnv(
      process.env.PAYMENT_RECONCILIATION_ENABLED,
      true
    ),
    intervalMs: Number(
      process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || 30000
    ),
    staleMs: Number(
      process.env.PAYMENT_RECONCILIATION_STALE_MS || 120000
    ),
    batchSize: Number(
      process.env.PAYMENT_RECONCILIATION_BATCH_SIZE || 20
    )
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;

    shuttingDown = true;

    console.log(
      `[PAYMENT_SERVICE] Received ${signal}. Shutting down...`
    );

    let shutdownFailed = false;

    try {
      await worker.stop();
      console.log('[PAYMENT_SERVICE] Reconciliation worker stopped');
    } catch (error) {
      shutdownFailed = true;
      console.error(
        '[PAYMENT_SERVICE] Failed to stop reconciliation worker',
        error
      );
    }

    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      console.log('[PAYMENT_SERVICE] HTTP server closed');
    } catch (error) {
      shutdownFailed = true;
      console.error(
        '[PAYMENT_SERVICE] HTTP server shutdown failed',
        error
      );
    }

    try {
      await pool.end();
      console.log('[PAYMENT_SERVICE] Database pool closed');
    } catch (error) {
      shutdownFailed = true;
      console.error(
        '[PAYMENT_SERVICE] Database pool shutdown failed',
        error
      );
    }

    if (shutdownFailed) {
      process.exitCode = 1;
      console.error('[PAYMENT_SERVICE] Shutdown completed with errors');
    } else {
      console.log('[PAYMENT_SERVICE] Graceful shutdown completed');
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer().catch(error => {
  console.error('Failed to start Payment Service:', error);
  process.exitCode = 1;
});
