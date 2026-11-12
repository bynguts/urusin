import { MulaiPendampingRequestSchema } from '@urusin/contracts';
import { matchOfficialOrigin } from '@urusin/core';
import { ADAPTER_GENERIK, jalurModeUji, mulaiPengajuan, punyaReplikaUji } from '@urusin/harness';
import { routeByKode } from '@urusin/registry';
import { catatHasilEksekusi } from '#lib/server/eksekusi.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { mulaiSesi, panggilPemilik, pendampingConfig, skema, teruskan } from '#lib/server/pendamping.js';
import {
  PESAN_MODE_UJI_TANPA_REPLIKA,
  hentikanNavigator,
  pulihkanNavigator,
} from '#lib/server/pendamping/navigator.js';
import {
  akunDari,
  modePendamping,
  peranPendamping,
  PESAN_PERLU_MASUK,
} from '#lib/server/pendamping/pemilik.js';
import { catatSesiAsli, remPortalAsli } from '#lib/server/pendamping/rem.js';
import { akses } from './akses';
import { ExecutionPayload, catatHasilSesi, eksekusiDitawarkan } from './hasil';
import type { RequestHandler } from './$types';

/** Sesi yang langkahnya sudah selesai (siaga) atau berakhir: tidak ada yang digerakkan Navigator. */
const SESI_TANPA_LOOP: ReadonlySet<string> = new Set([
  'siaga',
  'selesai',
  'gagal',
  'dipandu',
  'kedaluwarsa',
  'dibatalkan',
]);

/**
 * Mulai Browser Pendamping untuk `execution_request` yang sudah disetujui warga (layar konfirmasi). Langkah
 * berasal dari adapter bawaan di layanan pendamping, bukan dari model. Origin: yang dibawa permintaan (tool
 * baca-saja non-dukcapil, mis. Samsat/OSS; ditulis kode tool, tersimpan di event) atau portal kota dari registry.
 * Layanan pendamping menolak origin yang tidak sama dengan origin adapter.
 */
export const POST: RequestHandler = async ({ request, params, getClientAddress }) => {
  const body = await readBody(request, MulaiPendampingRequestSchema);
  if (!body.ok) return body.response;
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const offered = ExecutionPayload.safeParse(
      a.rt.store.findOffered(a.u.id, 'execution_request', { executionId: body.data.executionId }),
    );
    if (!offered.success)
      return apiError(404, 'EKSEKUSI_TIDAK_DITEMUKAN', 'Permintaan eksekusi ini tidak dikenal.');
    const origin =
      offered.data.origin ??
      (a.u.kodeKabKota ? routeByKode(a.u.kodeKabKota).entry.portal?.origin : undefined);
    if (!origin || !matchOfficialOrigin(origin).ok)
      return apiError(422, 'ADAPTER_TIDAK_ADA', 'Kota ini belum mendukung Browser Pendamping.');
    // Situs resmi asli untuk akun warga pemiliknya, dan untuk juri (salinan demo) dalam mode lihat saja; juri yang
    // meminta simulasi dan tamu ke replika uji.
    const { modeUji, lihatSaja } = await modePendamping(request, a.u, { simulasi: body.data.simulasi });
    // Simulasi hanya untuk portal yang punya replika (tombolnya disembunyikan bila tidak ada).
    if (body.data.simulasi === true && modeUji && !punyaReplikaUji(origin))
      return apiError(422, 'PENDAMPING_TANPA_REPLIKA', PESAN_MODE_UJI_TANPA_REPLIKA);
    // Tamu di portal tanpa replika: jangan buka sesi yang pasti beralih ke panduan; minta masuk/daftar dulu.
    if (modeUji && !punyaReplikaUji(origin) && peranPendamping(await akunDari(request)) === 'tamu')
      return apiError(403, 'PERLU_MASUK', PESAN_PERLU_MASUK);
    // Portal asli (akun warga pemilik, juga demo lihat saja): satu sesi aktif per akun + kuota mulai per jam per
    // akun/IP. Mode Uji bebas.
    const akunAsli = modeUji ? undefined : await akunDari(request);
    if (akunAsli) {
      let ip = 'tak-dikenal';
      try {
        ip = getClientAddress();
      } catch {
        // tanpa alamat klien: semuanya berbagi satu kunci (lebih ketat, bukan lebih longgar)
      }
      const ditolak = await remPortalAsli(a.rt, {
        akunId: akunAsli.id,
        urusanId: a.u.id,
        executionId: offered.data.executionId,
        ip,
      });
      if (ditolak) return ditolak;
    }
    const cfg = pendampingConfig();
    const generik = offered.data.adapterId === ADAPTER_GENERIK;
    // Mode Uji generik: replika dipasang di awalan override worker; jalur portal asli hanya dibawa bila replika
    // mendeklarasikannya, selain itu akar replika.
    const paramsSesi =
      modeUji && generik
        ? { ...offered.data.params, jalur: jalurModeUji(origin, offered.data.params.jalur) }
        : offered.data.params;
    const r = await mulaiSesi(cfg, {
      urusanId: a.u.id,
      sidHash: a.sidHash,
      executionId: offered.data.executionId,
      adapterId: offered.data.adapterId,
      flowId: offered.data.flowId,
      origin,
      params: paramsSesi,
      modeUji,
      ...(lihatSaja ? { lihatSaja: true } : {}),
      ...(body.data.viewport ? { viewport: body.data.viewport } : {}),
    });
    // Fail closed: demo lihat saja diminta, tetapi worker tidak menegakkannya (image lama membuang field, atau
    // sesi simulasi lama dengan executionId yang sama). Tutup sesinya, jangan biarkan berjalan tanpa gerbang.
    if (r.ok && lihatSaja && r.data.lihatSaja !== true) {
      hentikanNavigator(a.u.id);
      await panggilPemilik(cfg, '/internal/sesi/akhiri', skema.sesi, {
        urusanId: a.u.id,
        sidHash: a.sidHash,
      });
      return apiError(
        503,
        'LAYANAN_TIDAK_TERSEDIA',
        'Browser Pendamping sedang tidak tersedia. Coba lagi sebentar lagi.',
      );
    }
    if (r.ok) {
      // Dasar jujur agen chat (`statusPendamping`, catatan terakhir menang): mode sesi yang BENAR-BENAR dibuka
      // worker, demo lihat saja di situs asli atau simulasi di replika dengan data contoh.
      const modeSesi =
        r.data.lihatSaja === true
          ? 'lihat_saja'
          : body.data.simulasi === true && r.data.replika === true
            ? 'simulasi'
            : undefined;
      if (modeSesi)
        a.rt.publish(a.u.id, {
          type: 'jejak_pendamping',
          executionId: offered.data.executionId,
          catatan: { jenis: modeSesi },
        });
      if (akunAsli)
        catatSesiAsli(a.rt, {
          akunId: akunAsli.id,
          urusanId: a.u.id,
          executionId: offered.data.executionId,
          sidHash: a.sidHash,
        });
      a.rt.publish(a.u.id, { type: 'progress', label: 'Browser Pendamping disiapkan.' });
      if (offered.data.bacaSaja !== true)
        mulaiPengajuan(a.rt.store, a.u.id, (e) => void a.rt.publish(a.u.id, e));
      // Portal wilayah tanpa adapter: otak Navigator generik di web menggerakkan sesi lewat kanal internal.
      // Worker idempoten per executionId: POST ulang (reload) tidak memasang loop baru beranggaran penuh untuk
      // eksekusi yang pernah jalan, dan sesi siaga/berakhir tidak digerakkan sama sekali.
      // Sesi yang sudah ada dengan mode lain (lihat saja vs simulasi; mis. penutupan sebelumnya gagal) tidak
      // digerakkan dengan mode permintaan ini.
      if (
        offered.data.adapterId === ADAPTER_GENERIK &&
        !SESI_TANPA_LOOP.has(r.data.status) &&
        (r.data.lihatSaja === true) === lihatSaja
      )
        await pulihkanNavigator(
          a.rt,
          {
            urusan: a.u,
            executionId: offered.data.executionId,
            owner: { urusanId: a.u.id, sidHash: a.sidHash },
            modeUji,
            lihatSaja,
          },
          { cfg },
        );
    }
    // Mode Uji generik tanpa replika (worker menolak 422): panduan langkah dengan pesan templat.
    else if (
      modeUji &&
      offered.data.adapterId === ADAPTER_GENERIK &&
      r.response.status === 422 &&
      (await r.response
        .clone()
        .json()
        .then((b: { kode?: unknown }) => b?.kode === 'ADAPTER_TIDAK_ADA')
        .catch(() => false))
    ) {
      catatHasilEksekusi(a.rt, a.u, offered.data.executionId, 'drift', 'Browser Pendamping', {
        labelKhusus: PESAN_MODE_UJI_TANPA_REPLIKA,
      });
      return apiError(422, 'PENDAMPING_TANPA_REPLIKA', PESAN_MODE_UJI_TANPA_REPLIKA);
    }
    // Situs khusus jaringan Indonesia tanpa worker wilayah yang hidup: jujur, lalu beralih ke panduan langkah.
    else if (r.dipandu)
      catatHasilEksekusi(a.rt, a.u, offered.data.executionId, 'drift', 'Browser Pendamping', {
        labelKhusus: r.dipandu,
        bacaSaja: offered.data.bacaSaja === true,
      });
    return teruskan(r);
  } catch (e) {
    return errorResponse(e);
  }
};

/**
 * Status sesi (layar antrean, banner mode). Saat execution berakhir (sesi selesai atau siaga), hasilnya
 * dicatat ke urusan sekali, beserta bukti dari halaman konfirmasi (nomor registrasi/status) bila ada.
 */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id, true);
    if (!a.ok) return a.response;
    const r = await panggilPemilik(pendampingConfig(), '/internal/sesi/status', skema.sesi, {
      urusanId: a.u.id,
      sidHash: a.sidHash,
    });
    if (!r.ok) return r.response;
    const offered = eksekusiDitawarkan(a, r.data.executionId);
    // Sesi generik bermode AI tanpa loop Navigator (web restart / loop sudah berhenti): pulihkan atau
    // kembalikan kendali ke warga, supaya layar tidak tertahan "AI sedang mengisi".
    if (
      offered.success &&
      offered.data.adapterId === ADAPTER_GENERIK &&
      r.data.mode === 'ai' &&
      (r.data.status === 'berjalan' || r.data.status === 'menunggu_data')
    ) {
      // Mode sesi yang SEDANG berjalan (replika atau situs asli) dari worker; juri di situs asli = lihat saja.
      const mode = await modePendamping(request, a.u, { simulasi: r.data.replika === true });
      await pulihkanNavigator(
        a.rt,
        {
          urusan: a.u,
          executionId: r.data.executionId,
          owner: { urusanId: a.u.id, sidHash: a.sidHash },
          modeUji: mode.modeUji,
          lihatSaja: mode.lihatSaja || r.data.lihatSaja === true,
        },
        { cfg: pendampingConfig() },
      );
    }
    catatHasilSesi(a, r.data);
    return apiJson(r.data);
  } catch (e) {
    return errorResponse(e);
  }
};

/** Akhiri sesi sekarang: peramban dan semua data di memorinya dihancurkan. */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id, true);
    if (!a.ok) return a.response;
    const owner = { urusanId: a.u.id, sidHash: a.sidHash };
    hentikanNavigator(a.u.id);
    return teruskan(await panggilPemilik(pendampingConfig(), '/internal/sesi/akhiri', skema.sesi, owner));
  } catch (e) {
    return errorResponse(e);
  }
};
