import { verifyMain } from './verify-cli-main.js';

process.exitCode = await verifyMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
