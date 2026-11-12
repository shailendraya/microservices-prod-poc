import { gql } from 'graphql-tag';

export const typeDefs = gql`
  enum PaymentStatus {
    PENDING
    PROCESSING
    SUCCESS
    FAILED
  }

  type Payment {
    id: ID!
    orderId: ID!
    amount: Float!
    currency: String!
    status: PaymentStatus!
    failureReason: String
    createdAt: String!
  }

  type Query {
    payment(id: ID!): Payment
    paymentsByOrderId(orderId: ID!): [Payment!]!
  }

  type Mutation {
    processPayment(
      orderId: ID!
      idempotencyKey: String!
      amount: Float!
      currency: String!
    ): Payment!
  }
`;
