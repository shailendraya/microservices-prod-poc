import { pool } from './database.js';

async function testDatabase() {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS username'
    );

    console.log('Database connected:', result.rows[0].database);
    console.log('Database user:', result.rows[0].username);
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testDatabase();
