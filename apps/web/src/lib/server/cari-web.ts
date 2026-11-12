import { nilaiEnv } from '@urusin/akun';
import { egressFetch, type EgressFetch } from '@urusin/egress';
import { buatCariWebExa, type CariWeb } from '@urusin/harness';

/**
 * Cari web cadangan (Exa) dari env. `EXA_API_KEY` kosong atau placeholder `ganti-dengan-…` = mati: tool
 * `web__cari` tidak didaftarkan ke model sama sekali. Lalu lintas lewat egress runtime (host `api.exa.ai` di
 * allowlist `EXA_HOSTS`); kunci hanya di header, tidak pernah dicatat.
 */
export function cariWebDariEnv(
  env: Record<string, string | undefined> = process.env,
  fetch: EgressFetch = egressFetch,
): CariWeb | undefined {
  const apiKey = nilaiEnv(env.EXA_API_KEY);
  return apiKey ? buatCariWebExa({ apiKey, fetch }) : undefined;
}
