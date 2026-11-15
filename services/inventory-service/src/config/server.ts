import 'dotenv/config';

import { createApp, stopApp } from '../app.js';
import { pool } from './database.js';
import { startInventoryExpiryWorker } from '../workers/inventory-expiry.worker.js';

const PORT = Number(process.env.PORT || 4002);
const SHUTDOWN_TIMEOUT_MS = 10000;

const app = await createApp();

const stopExpiryWorker = startInventoryExpiryWorker();

const server = app.listen(PORT, () => {
  console.log(
    `Inventory Service running at http://localhost:${PORT}/graphql`
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`[INVENTORY_SERVICE] ${signal} received. Shutting down...`);

  let shutdownFailed = false;

  try {
    await stopExpiryWorker();
    console.log('[INVENTORY_SERVICE] Expiry worker stopped');
  } catch (error) {
    shutdownFailed = true;
    console.error('[INVENTORY_SERVICE] Failed to stop expiry worker', error);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      console.log("[INVENTORY_SERVICE] Starting HTTP shutdown...");
      const timeout = setTimeout(() => {
        console.warn(
          '[INVENTORY_SERVICE] HTTP shutdown timeout reached. Closing remaining connections.'
        );

        server.closeAllConnections();
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      console.log("[INVENTORY_SERVICE] Server listening:", server.listening);
      console.log("[INVENTORY_SERVICE] Calling server.close...");
      server.close((error?: Error) => {
        console.log("[INVENTORY_SERVICE] HTTP close callback invoked.");
        clearTimeout(timeout);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      server.closeIdleConnections();
      console.log("[INVENTORY_SERVICE] Idle connections closed.");
    });

    console.log('[INVENTORY_SERVICE] HTTP server closed');
  } catch (error) {
    shutdownFailed = true;
    console.error('[INVENTORY_SERVICE] HTTP server shutdown failed', error);
  }

  try {
    await stopApp();
  } catch (error) {
    shutdownFailed = true;
    console.error('[INVENTORY_SERVICE] Apollo Server shutdown failed', error);
  }

  try {
    await pool.end();
    console.log('[INVENTORY_SERVICE] Database pool closed');
  } catch (error) {
    shutdownFailed = true;
    console.error('[INVENTORY_SERVICE] Database shutdown failed', error);
  }

  if (shutdownFailed) {
    process.exitCode = 1;
    console.error('[INVENTORY_SERVICE] Shutdown completed with errors');
  } else {
    console.log('[INVENTORY_SERVICE] Graceful shutdown completed');
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});




