import 'dotenv/config';
import { createApp } from '../app.js';

const PORT = Number(process.env.PORT) || 4004;

async function startServer() {
  const app = await createApp();

  
  app.listen(PORT, () => {
    console.log(`Payment Service running at http://localhost:${PORT}/graphql`);
  });
}

startServer().catch(error => {
  console.error('Failed to start Payment Service:', error);
  process.exit(1);
});
