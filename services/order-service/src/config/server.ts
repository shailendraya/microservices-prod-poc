import 'dotenv/config';

import { createApp } from '../app.js';

const PORT = Number(process.env.PORT || 4003);

const app = await createApp();

app.listen(PORT, () => {
  console.log(`Order Service running at http://localhost:${PORT}/graphql`);
});
