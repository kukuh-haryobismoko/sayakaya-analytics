'use strict';

// Standalone server entrypoint: local dev, Cloud Run, or any Node host.
// (Netlify uses netlify/functions/api.js instead — see README.)

require('dotenv').config();
const { createApp } = require('./app');
const { PROJECT_ID, MAX_BYTES_BILLED } = require('./bigquery');

const PORT = process.env.PORT || 8080;
const app = createApp({ serveStatic: true });

app.listen(PORT, () => {
  console.log(`\n  Sayakaya Analytics running → http://localhost:${PORT}`);
  console.log(`  Project: ${PROJECT_ID}  |  Max bytes/query: ${MAX_BYTES_BILLED}`);
  console.log('  Auth: per-user login (Supabase Postgres)');
  console.log('');
});
