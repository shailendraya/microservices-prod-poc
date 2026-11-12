import { parse } from 'graphql';

export const typeDefs = parse(`
  type Product @key(fields: "sku") {
    sku: String!
    name: String!
    price: Float!
    currency: String!
    onHand: Int!
    reserved: Int!
    available: Int!
  }

  enum ReservationStatus {
    RESERVED
    CONFIRMED
    RELEASED
    EXPIRED
  }

  type ReservationItem {
    sku: String!
    quantity: Int!
  }

  type Reservation {
    id: ID!
    idempotencyKey: String!
    status: ReservationStatus!
    expiresAt: String!
    items: [ReservationItem!]!
  }

  input ReservationItemInput {
    sku: String!
    quantity: Int!
  }

  type Query {
    products: [Product!]!
    product(sku: String!): Product
    reservation(id: ID!): Reservation
  }

  type Mutation {
    reserveStock(
      items: [ReservationItemInput!]!
      idempotencyKey: String!
    ): Reservation!

    confirmReservation(id: ID!): Reservation!

    releaseReservation(id: ID!): Reservation!
  }
`);