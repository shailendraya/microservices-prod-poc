import { pool } from './database.js';

async function testConnection() {
  try {
    const result = await pool.query('SELECT current_database()');

    console.log('Database connected:', result.rows[0].current_database);
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();
