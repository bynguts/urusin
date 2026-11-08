import {
  DokumenAkunSchema,
  MIME_DOKUMEN,
  UKURAN_DOKUMEN_MAKS,
  UnggahDokumenFieldsSchema,
  type DaftarDokumenResponse,
} from '@urusin/contracts';
import type { DokumenMeta } from '@urusin/akun';
import { akunErrorResponse, wajibMasuk } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const publik = (d: DokumenMeta) =>
  DokumenAkunSchema.parse({
    id: d.id,
    jenis: d.jenis,
    judul: d.judul,
    mime: d.mime,
    ukuran: d.size,
    disimpanPada: d.createdAt,
  });

export const GET: RequestHandler = async ({ locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    return apiJson({
      dokumen: rt.akun.vault.listDocuments(m.id).map(publik),
    } satisfies DaftarDokumenResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/** Unggah dokumen (multipart: `berkas`, `jenis`, `judul`). Dienkripsi dengan DEK akun sebelum ditulis ke disk. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'BODY_INVALID', 'Berkas tidak terbaca. Coba lagi.');
  }
  const berkas = form.get('berkas');
  const fields = UnggahDokumenFieldsSchema.safeParse({ jenis: form.get('jenis'), judul: form.get('judul') });
  if (!(berkas instanceof File) || !fields.success)
    return apiError(422, 'BODY_INVALID', 'Pilih berkas, jenis, dan judul dokumen.');
  if (berkas.size > UKURAN_DOKUMEN_MAKS)
    return apiError(413, 'DOKUMEN_TERLALU_BESAR', 'Berkas terlalu besar. Maksimal 5 MB.');
  if (!(MIME_DOKUMEN as readonly string[]).includes(berkas.type))
    return apiError(415, 'DOKUMEN_JENIS_DITOLAK', 'Gunakan foto (JPG, PNG, WebP) atau PDF.');
  try {
    const rt = await getRuntime();
    const meta = rt.akun.vault.putDocument(m.id, {
      ...fields.data,
      mime: berkas.type,
      bytes: Buffer.from(await berkas.arrayBuffer()),
    });
    return apiJson(publik(meta), 201);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
