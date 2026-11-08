import { installEgressBackstop } from '@urusin/egress';
import { ingestMain } from './cli-main.js';

// Backstop (M2): fetch global apa pun di proses CLI ini lewat konektor egress profil ingest.
installEgressBackstop('ingest');

process.exitCode = await ingestMain(process.argv.slice(2), {
  env: process.env,
  log: console.log,
  error: console.error,
});
