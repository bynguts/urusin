import {
  BERKAS_PER_PEMILIK_MAKS,
  DokumenAkunSchema,
  MIME_DOKUMEN,
  PeriksaDokumenSchema,
  UKURAN_DOKUMEN_MAKS,
  UnggahDokumenFieldsSchema,
  type VaultResponse,
} from '@urusin/contracts';
import type { DokumenMeta } from '@urusin/akun';
import { akunErrorResponse, pemilikVault, tolakBacaVault } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { periksaUnggahan } from '#lib/server/periksa-dokumen.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const publikDokumen = (d: DokumenMeta) => {
  // Hasil periksa yang tidak sesuai skema (versi lama/rusak) tidak ditampilkan, tidak menggagalkan daftar.
  const periksa = PeriksaDokumenSchema.safeParse(d.periksa);
  return DokumenAkunSchema.parse({
    id: d.id,
    jenis: d.jenis,
    judul: d.judul,
    mime: d.mime,
    ukuran: d.size,
    disimpanPada: d.createdAt,
    ...(d.bacaSaja ? { bacaSaja: true } : {}),
    ...(periksa.success ? { periksa: periksa.data } : {}),
  });
};

/**
 * Isi vault pemilik TANPA nilai: ada/tidaknya Data Diri + daftar dokumen (judul milik pemilik sendiri).
 * Tamu yang belum pernah menulis tidak punya vault (tidak ada baris yang dibuat).
 */
export const GET: RequestHandler = async (event) => {
  const tolak = tolakBacaVault(event.request);
  if (tolak) return tolak;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const d = p ? rt.akun.vault.getDataDiri(p.id) : null;
    return apiJson({
      pemilik: p?.jenis ?? (event.locals.akun?.jenis === 'demo' ? 'demo' : 'tamu'),
      sinkron: p?.sinkron ?? false,
      dataDiri: { ada: d !== null, diubahPada: d?.updatedAt ?? null },
      dokumen: p ? rt.akun.vault.listDocuments(p.id).map(publikDokumen) : [],
      batas: { berkas: BERKAS_PER_PEMILIK_MAKS, ukuranBerkas: UKURAN_DOKUMEN_MAKS },
    } satisfies VaultResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/**
 * Unggah dokumen (multipart: `berkas`, `jenis`, `judul`). Dienkripsi dengan DEK pemilik sebelum ditulis ke
 * disk. Batas: 30 berkas x 9 MB per pemilik; penyimpanan host penuh → 507 dengan pesan jujur. Foto diperiksa
 * kejelasannya oleh model vision (`periksaUnggahan`): opsional `pratinjau` (data URL kecil dari perangkat) dan
 * `periksa=tunggu` (respons menunggu hasilnya, paling lama 15 detik).
 */
export const POST: RequestHandler = async (event) => {
  let form: FormData;
  try {
    form = await event.request.formData();
  } catch {
    return apiError(400, 'BODY_INVALID', 'Berkas tidak terbaca. Coba lagi.');
  }
  const berkas = form.get('berkas');
  const fields = UnggahDokumenFieldsSchema.safeParse({ jenis: form.get('jenis'), judul: form.get('judul') });
  if (!(berkas instanceof File) || !fields.success)
    return apiError(422, 'BODY_INVALID', 'Pilih berkas, jenis, dan judul dokumen.');
  if (berkas.size > UKURAN_DOKUMEN_MAKS)
    return apiError(413, 'DOKUMEN_TERLALU_BESAR', 'Berkas terlalu besar. Maksimal 9 MB.');
  if (!(MIME_DOKUMEN as readonly string[]).includes(berkas.type))
    return apiError(415, 'DOKUMEN_JENIS_DITOLAK', 'Gunakan foto (JPG, PNG, WebP), PDF, atau Word (DOCX).');
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: true })!;
    const bytes = Buffer.from(await berkas.arrayBuffer());
    const meta = rt.akun.vault.putDocument(p.id, { ...fields.data, mime: berkas.type, bytes });
    const periksa = await periksaUnggahan(
      rt,
      p.id,
      meta.id,
      { mime: berkas.type, bytes, pratinjau: form.get('pratinjau') },
      { tunggu: form.get('periksa') === 'tunggu' },
    );
    return apiJson(publikDokumen({ ...meta, ...(periksa ? { periksa } : {}) }), 201);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
