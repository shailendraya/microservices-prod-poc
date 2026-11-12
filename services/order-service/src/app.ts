import express from 'express';
import cors from 'cors';

import { ApolloServer } from '@apollo/server';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { expressMiddleware } from '@as-integrations/express4';

import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';

const apolloServer = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }])
});

export async function createApp() {
  await apolloServer.start();

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      service: 'order-service',
      status: 'healthy'
    });
  });

  app.use('/graphql', expressMiddleware(apolloServer));

  return app;
}
