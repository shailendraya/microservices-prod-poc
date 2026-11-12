import { GraphQLError } from 'graphql';

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
} from '../repositories/user.repository.js';

const validateEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const resolvers = {
  Query: {
    users: () => getUsers(),

    user: (_: unknown, args: { id: string }) =>
      getUserById(args.id)
  },

  Mutation: {
    createUser: async (_: unknown, args: any) => {
      const name = args.input.name.trim();
      const email = args.input.email.trim().toLowerCase();

      if (!name || !email || !validateEmail(email)) {
        throw new GraphQLError('Invalid name or email', {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }

      try {
        return await createUser({ name, email });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new GraphQLError('Email already exists', {
            extensions: { code: 'BAD_USER_INPUT' }
          });
        }
        throw error;
      }
    },

    updateUser: async (_: unknown, args: any) => {
      const input: { name?: string; email?: string } = {};

      if (args.input.name !== undefined) {
        input.name = args.input.name.trim();

        if (!input.name) {
          throw new GraphQLError('Name cannot be empty', {
            extensions: { code: 'BAD_USER_INPUT' }
          });
        }
      }

      if (args.input.email !== undefined) {
  const email = args.input.email.trim().toLowerCase();

  if (!validateEmail(email)) {
    throw new GraphQLError('Invalid email address', {
      extensions: { code: 'BAD_USER_INPUT' }
    });
  }

  input.email = email;
}

      if (Object.keys(input).length === 0) {
        throw new GraphQLError('Provide at least one field to update', {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }

      try {
        const user = await updateUser(args.id, input);

        if (!user) {
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }

        return user;
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new GraphQLError('Email already exists', {
            extensions: { code: 'BAD_USER_INPUT' }
          });
        }
        throw error;
      }
    },

    deleteUser: async (_: unknown, args: { id: string }) => {
      const deleted = await deleteUser(args.id);

      if (!deleted) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' }
        });
      }

      return true;
    }
  },

  User: {
    __resolveReference: (reference: { id: string }) =>
      getUserById(reference.id)
  }
};
