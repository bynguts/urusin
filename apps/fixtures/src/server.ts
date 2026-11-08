import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`fixtures (profil ${config.profile}) mendengarkan di http://localhost:${info.port}`);
});
