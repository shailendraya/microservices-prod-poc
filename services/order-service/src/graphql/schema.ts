import { parse } from 'graphql';

export const typeDefs = parse(`
  enum OrderStatus {
    PENDING
    CONFIRMED
    FAILED
  }

  enum PaymentStatus {
    PENDING
    PROCESSING
    SUCCESS
    FAILED
  }

  type OrderItem {
    sku: String!
    productName: String!
    unitPrice: Float!
    currency: String!
    quantity: Int!
    lineTotal: Float!
  }

  type Order {
    id: ID!
    userId: ID!
    idempotencyKey: String!
    status: OrderStatus!
    totalAmount: Float!
    currency: String!
    inventoryReservationId: ID
    paymentId: ID
    paymentStatus: PaymentStatus
    failureReason: String
    createdAt: String!
    items: [OrderItem!]!
  }

  input CreateOrderItemInput {
    sku: String!
    quantity: Int!
  }

  type Query {
    order(id: ID!): Order
    orders(userId: ID!): [Order!]!
  }

  type Mutation {
    createOrder(
      userId: ID!
      idempotencyKey: String!
      items: [CreateOrderItemInput!]!
    ): Order!
  }
`);
