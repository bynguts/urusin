import { ingestMain } from './cli-main.js';

process.exitCode = await ingestMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
