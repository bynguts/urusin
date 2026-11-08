import { installEgressBackstop } from '@urusin/egress';
import { evalMain } from './cli-main.js';

// Backstop (M2): fetch global apa pun di proses CLI ini lewat konektor egress profil runtime.
installEgressBackstop();

process.exitCode = await evalMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
