import express from 'express';
import { ApolloServer } from '@apollo/server';
import { buildSubgraphSchema } from '@apollo/subgraph';

import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';

export const app = express();

export const apolloServer = new ApolloServer({
  schema: buildSubgraphSchema([
    {
      typeDefs,
      resolvers
    }
  ])
});
