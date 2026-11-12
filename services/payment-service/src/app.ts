import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';

export async function createApp() {
  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers
  });

  await apolloServer.start();

  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      service: 'payment-service',
      status: 'healthy'
    });
  });

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer)
  );

  return app;
}
