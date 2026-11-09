import { isTerminal, type UrusanRow } from '@urusin/harness';
import { apiError } from '#lib/server/http.js';
import { hashSid, milikAkun, sidDariRequest } from '#lib/server/pendamping.js';
import { getRuntime, type Runtime } from '#lib/server/runtime.js';

export type Akses =
  { ok: true; rt: Runtime; u: UrusanRow; sidHash: string } | { ok: false; response: Response };

/**
 * Syarat bersama endpoint pendamping: cookie sesi yang sudah ada + urusan yang ada, milik akun yang masuk
 * (`pasangPemeriksaPemilikAkun`), dan belum selesai. Urusan milik akun lain dijawab sama dengan yang tidak ada.
 */
export async function akses(request: Request, id: string, bolehTerminal = false): Promise<Akses> {
  const sid = sidDariRequest(request);
  if (!sid)
    return {
      ok: false,
      response: apiError(401, 'SESI_DIPERLUKAN', 'Muat ulang halaman Urusin lalu coba lagi.'),
    };
  const rt = await getRuntime();
  const u = rt.store.getUrusan(id);
  if (!u || !(await milikAkun(request, u)))
    return { ok: false, response: apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.') };
  if (!bolehTerminal && isTerminal(u.state))
    return { ok: false, response: apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.') };
  return { ok: true, rt, u, sidHash: hashSid(sid) };
}
