import { matrixMain } from './matrix-main.js';

process.exitCode = await matrixMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
