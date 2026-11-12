import { pool } from './database.js';

try {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      (SELECT COUNT(*) FROM products) AS product_count
  `);

  console.log(
    'Database connected:',
    result.rows[0].database_name
  );

  console.log(
    'Products available:',
    result.rows[0].product_count
  );
} catch (error) {
  console.error('Database connection failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}