import { evalMain } from './cli-main.js';

process.exitCode = await evalMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
