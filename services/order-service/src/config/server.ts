import 'dotenv/config';

import { createApp } from '../app.js';
import { pool } from './database.js';
import { startOrderRecoveryWorker } from '../workers/order-recovery.worker.js';

const PORT = Number(process.env.PORT || 4003);

const app = await createApp();

const server = app.listen(PORT, () => {
  console.log(`Order Service running at http://localhost:${PORT}/graphql`);
});

const stopRecoveryWorker = startOrderRecoveryWorker();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`[ORDER_SERVICE] ${signal} received. Shutting down...`);

  let shutdownFailed = false;

  // Stop the recovery worker first.
  try {
    await stopRecoveryWorker();
  } catch (error) {
    shutdownFailed = true;
    console.error('[ORDER_SERVICE] Failed to stop recovery worker', error);
  }

  // Stop accepting new HTTP connections and wait for active requests.
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    shutdownFailed = true;
    console.error('[ORDER_SERVICE] HTTP server shutdown failed', error);
  }

  // Close PostgreSQL connections.
  try {
    await pool.end();
    console.log('[ORDER_SERVICE] Database pool closed');
  } catch (error) {
    shutdownFailed = true;
    console.error('[ORDER_SERVICE] Database pool shutdown failed', error);
  }

  if (shutdownFailed) {
    process.exitCode = 1;
    console.error('[ORDER_SERVICE] Shutdown completed with errors');
  } else {
    console.log('[ORDER_SERVICE] Graceful shutdown completed');
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
