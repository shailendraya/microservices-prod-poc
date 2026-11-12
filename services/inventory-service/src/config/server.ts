import 'dotenv/config';

import { createApp } from '../app.js';

const PORT = Number(process.env.PORT || 4002);

const app = await createApp();

app.listen(PORT, () => {
  console.log(
    `Inventory Service running at http://localhost:${PORT}/graphql`
  );
});