import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { ApolloGateway } from '@apollo/gateway';
import { expressMiddleware } from '@as-integrations/express4';

const PORT = Number(process.env.PORT) || 4000;

const gateway = new ApolloGateway({
  serviceList: [
    {
      name: 'user',
      url: 'http://localhost:4001/graphql'
    },
    {
      name: 'inventory',
      url: 'http://localhost:4002/graphql'
    },
    {
      name: 'order',
      url: 'http://localhost:4003/graphql'
    }
  ]
});

const apolloServer = new ApolloServer({
  gateway
});

async function startServer() {
  await apolloServer.start();

  const app = express();

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer)
  );

  app.listen(PORT, () => {
    console.log(`GraphQL Gateway running at http://localhost:${PORT}/graphql`);
  });
}

startServer().catch(error => {
  console.error('Failed to start GraphQL Gateway:', error);
  process.exit(1);
});
