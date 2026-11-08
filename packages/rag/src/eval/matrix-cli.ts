import { installEgressBackstop } from '@urusin/egress';
import { matrixMain } from './matrix-main.js';

// Backstop (M2): fetch global apa pun di proses CLI ini lewat konektor egress profil runtime.
installEgressBackstop();

process.exitCode = await matrixMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
