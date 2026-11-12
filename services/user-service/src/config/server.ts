import express from 'express';
import cors from 'cors';
import { expressMiddleware } from '@as-integrations/express4';

import { app, apolloServer } from '../app.js';

const PORT = Number(process.env.PORT) || 4001;

async function startServer() {
  await apolloServer.start();

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer)
  );

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'user-service'
    });
  });

  app.listen(PORT, () => {
    console.log(`User Service running at http://localhost:${PORT}/graphql`);
  });
}

startServer().catch(error => {
  console.error('Failed to start User Service:', error);
  process.exit(1);
});