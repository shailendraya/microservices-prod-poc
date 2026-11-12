import { pool } from '../config/database.js';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

export async function getUsers(): Promise<User[]> {
  const result = await pool.query(
    'SELECT id, name, email FROM users ORDER BY id'
  );
  return result.rows;
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await pool.query(
    'SELECT id, name, email FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const result = await pool.query(
    `INSERT INTO users (name, email)
     VALUES ($1, $2)
     RETURNING id, name, email`,
    [input.name, input.email]
  );
  return result.rows[0];
}

export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<User | null> {
  const result = await pool.query(
    `UPDATE users
     SET name = COALESCE($2, name),
         email = COALESCE($3, email)
     WHERE id = $1
     RETURNING id, name, email`,
    [id, input.name ?? null, input.email ?? null]
  );

  return result.rows[0] ?? null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING id',
    [id]
  );

  return result.rowCount === 1;
}
