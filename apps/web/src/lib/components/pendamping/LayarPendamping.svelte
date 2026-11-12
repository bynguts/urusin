<script lang="ts" module>
  import type { GiliranAnda } from '#lib/pendamping/sesi.svelte.js';

  /**
   * Instruksi ringkas "Giliran Anda: …" untuk bilah bawah yang selalu terlihat di HP. Mengikuti alasan giliran dan
   * menyebut kendali sasaran bila worker mengirim namanya (`kendali`, `tombol`, `tautan.nama`: teks situs, tampil
   * sebagai teks biasa). Tanpa giliran (warga mengambil alih / dijeda) = isi formulir di layar.
   */
  export function instruksiGiliran(g: GiliranAnda | null): string {
    if (!g) return 'isi formulir di layar ini';
    const k = g.kendali ? `“${g.kendali}”` : undefined;
    switch (g.alasan) {
      case 'login':
        return 'selesaikan masuk akun, kode, atau CAPTCHA di situs';
      case 'masuk_akun':
        return k ? `ketuk ${k} di situs, lalu masuk akun` : 'masuk akun di situs';
      case 'verifikasi_situs':
        return 'selesaikan pemeriksaan keamanan situs';
      case 'final':
        return g.tombol ? `periksa isian, lalu tekan “${g.tombol}”` : 'periksa isian, lalu kirim sendiri';
      case 'isi_sendiri':
        return k ? `isi ${k} di situs, lalu tekan Lanjutkan` : 'isi kolom di situs, lalu tekan Lanjutkan';
      case 'berkas_kurang':
        return 'tambahkan dokumen yang kurang';
      case 'ketuk_tautan':
        return g.tautan?.nama ? `buka “${g.tautan.nama}”` : 'buka tautan di situs';
      case 'berhenti':
        return 'lanjutkan sendiri di situs';
      case 'periksa':
        return k ? `periksa halaman, lalu ketuk ${k} bila sudah benar` : 'periksa halaman di situs';
      default:
        return 'lanjutkan di situs';
    }
  }

  /**
   * Label kerja AI di bilah bawah: fase nyata dari worker (`langkah.label` adapter). Navigator generik belum
   * mengirim fase, jadi bawaannya jujur "membaca halaman", tidak pernah "Mengisi formulir".
   */
  export function labelKerjaAi(langkah: { label: string } | null): string {
    return langkah?.label.trim() || 'AI sedang membaca halaman…';
  }
</script>

<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '../Icon.svelte';
  import ChipMode from './ChipMode.svelte';
  import { PESAN_GAGAL_TUTUP, type DataPendamping } from '#lib/pendamping/sesi.svelte.js';
  import { domain } from '#lib/urusan-status.js';

  /**
   * Browser Pendamping, ukuran dan warna persis dari pen Rafi: App 06 (AI mengisi), App 07 (Giliran Anda)
   * dan papan u5rYk "Browser Pendamping · Keadaan" (antre, menyiapkan, dijeda, selesai, sesi berakhir,
   * terputus, mode dipandu). Komponen ini hanya tampilan; canvas dan input tersembunyi diikat ke pemanggil.
   */
  let {
    data,
    situs,
    instansi,
    canvas = $bindable(null),
    inputTeks = $bindable(null),
    onambilalih,
    onkembalikan,
    onbukatautan = () => {},
    onsudahkirim = () => {},
    onhentikan,
    ontutup,
    menutup = false,
    onmulailagi,
    onpanduan,
    onsimulasi,
  }: {
    data: DataPendamping;
    situs: string;
    instansi?: string | undefined;
    canvas?: HTMLCanvasElement | null;
    inputTeks?: HTMLTextAreaElement | null;
    onambilalih: () => void;
    onkembalikan: () => void;
    /** Giliran ketuk_tautan: buka tautan pembuka yang disorot lewat worker (bukan ketukan di halaman). */
    onbukatautan?: () => void;
    /** AI berhenti / warga memegang kendali: "Saya sudah mengirim" (worker memeriksa halaman sukses). */
    onsudahkirim?: () => void;
    onhentikan: () => void;
    /** Tutup peramban server (DELETE sesi), lalu kembali ke percakapan. */
    ontutup: () => void;
    menutup?: boolean;
    onmulailagi: () => void;
    onpanduan: () => void;
    /**
     * Akun demo di situs asli (lihat saja) dan portalnya punya replika: buka simulasi pengisian dengan data contoh
     * di replika. undefined = tombol tidak ditampilkan (akun warga biasa tidak pernah melihatnya).
     */
    onsimulasi?: (() => void) | undefined;
  } = $props();

  const k = $derived(data.keadaan);
  const siaran = $derived(
    k === 'ai' || k === 'giliran' || k === 'dijeda' || k === 'siaga' || k === 'terputus',
  );
  const takeover = $derived(data.mode === 'takeover');
  const persen = $derived(
    data.langkah
      ? Math.round(((data.langkah.indeks + 1) / data.langkah.total) * 100)
      : k === 'selesai'
        ? 100
        : 0,
  );

  const JUDUL_GILIRAN: Record<string, string> = {
    login: 'Masuk akun di situs resmi',
    masuk_akun: 'Masuk akun di situs resmi',
    verifikasi_situs: 'Selesaikan pemeriksaan keamanan situs',
    final: 'Periksa isian, lalu kirim sendiri',
    periksa: 'Periksa halaman ini',
    isi_sendiri: 'Isi kolom ini sendiri',
    berkas_kurang: 'Dokumen belum ada',
    ketuk_tautan: 'Buka tautan di situs',
    berhenti: 'AI berhenti',
  };
  const CATATAN_GILIRAN: Record<string, string> = {
    login: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    masuk_akun: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    verifikasi_situs: 'Situs memeriksa keamanan. Centang kotaknya sendiri.',
    final: 'AI dikunci agar tidak bisa mengirim.',
    periksa: 'AI tidak menjalankan apa pun selama giliran Anda.',
    isi_sendiri: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    berkas_kurang: 'Lanjutkan meminta izin Anda untuk mengunggah dokumen itu saja.',
    ketuk_tautan: 'AI tidak mengetuk tautan ini; Anda yang membukanya.',
    berhenti: 'Yang Anda ketik tidak dicatat dan tidak dilihat AI.',
  };
  // Tautan pembuka yang disorot (nama = teks situs, tak tepercaya: hanya tampil sebagai teks).
  const tautan = $derived(data.giliran?.alasan === 'ketuk_tautan' ? data.giliran.tautan : undefined);
  // Giliran kirim: nama tombol dibaca dari halaman (mis. "Selesai"), bukan nama karangan Urusin.
  const tombolKirim = $derived(data.giliran?.alasan === 'final' ? data.giliran.tombol : undefined);
  const judulGiliran = $derived(
    tombolKirim
      ? `Periksa isian, lalu tekan ${tombolKirim}`
      : data.situs?.lihatSaja && data.giliran?.alasan === 'berhenti'
        ? 'Mode demo: AI hanya melihat'
        : data.situs?.replika && (data.giliran?.alasan === 'login' || data.giliran?.alasan === 'masuk_akun')
          ? 'Masuk akun di situs uji'
          : ((data.giliran && JUDUL_GILIRAN[data.giliran.alasan]) ?? 'Giliran Anda'),
  );
  const isiGiliran = $derived(
    data.giliran
      ? [
          data.giliran.pesan,
          tombolKirim
            ? `AI dikunci agar tidak bisa menekan ${tombolKirim}.`
            : CATATAN_GILIRAN[data.giliran.alasan],
        ]
          .filter(Boolean)
          .join(' ')
      : '',
  );

  function ketuk() {
    // Keyboard ponsel: fokuskan input tersembunyi saat warga mengetuk siaran dalam mode takeover.
    if (takeover) inputTeks?.focus();
  }

  // Tombol papan u5rYk: tinggi 44, padding 0 16, jarak 7, 15/600.
  const TOMBOL_GELAP =
    'inline-flex h-11 items-center gap-[7px] rounded-full bg-primer px-4 text-[15px] font-semibold whitespace-nowrap text-primer-ink';
  const TOMBOL_TERANG =
    'inline-flex h-11 items-center gap-[7px] rounded-full border border-line-2 bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-ink hover:bg-card';
  const LINGKAR = 'grid size-12 shrink-0 place-items-center rounded-full';
  const JUDUL = 'text-xl leading-normal font-bold text-ink';
  const TEKS = 'w-full max-w-[280px] text-center text-sm leading-5 text-muted';
</script>

{#snippet aksiGiliran(g: GiliranAnda)}
  <!-- Tombol aksi giliran: di bilah bawah yang lengket di HP, jadi selalu terlihat bersama instruksinya. -->
  {#if ['isi_sendiri', 'berkas_kurang', 'ketuk_tautan'].includes(g.alasan)}
    <!-- Kolom di luar Data Diri (mis. nomor kitir), Dokumen yang belum ada, atau tautan pembuka formulir
           yang hanya boleh diketuk warga: warga, lalu AI lanjut. -->
    <div class="flex flex-wrap gap-2">
      {#if g.alasan === 'berkas_kurang'}
        <a href={resolve('/dokumen')} target="_blank" rel="noopener" class={TOMBOL_TERANG}>Buka Dokumen</a>
      {/if}
      {#if tautan}
        <button
          type="button"
          onclick={onbukatautan}
          data-buka-tautan
          class="inline-flex min-h-11 max-w-full items-center gap-[7px] rounded-full bg-primer px-4 py-2 text-left text-[15px] font-semibold text-primer-ink"
        >
          <span class="min-w-0 break-words"
            >Buka “{tautan.nama || 'tautan'}”
            <span class="font-normal opacity-80">({tautan.host}{tautan.jalur})</span></span
          >
        </button>
      {/if}
      {#if !tautan}
        <!-- Tautan pembuka dengan tujuan dari worker: Buka (worker yang membuka, lalu AI lanjut). -->
        <button type="button" onclick={onkembalikan} class={TOMBOL_GELAP}>
          <Icon name="putar" class="size-[15px]" />Lanjutkan
        </button>
      {/if}
    </div>
  {:else if g.alasan === 'login' || g.alasan === 'masuk_akun'}
    <!-- Masuk akun / CAPTCHA / OTP: worker mendeteksi sendiri giliran yang selesai (halaman berganti, formulir
           masuk hilang) lalu AI lanjut. Bila belum terdeteksi, warga menekan ini sebagai cadangan. -->
    <div class="flex flex-wrap gap-2">
      <button type="button" onclick={onkembalikan} data-sudah-lanjut class={TOMBOL_GELAP}>
        <Icon name="putar" class="size-[15px]" />Sudah, lanjutkan
      </button>
    </div>
  {:else if g.alasan === 'berhenti' && !data.situs?.lihatSaja}
    <!-- Demo lihat saja: tidak ada yang bisa dikirim, jadi tidak ada "Saya sudah mengirim". -->
    {@render sudahKirim()}
  {:else if g.alasan === 'periksa'}
    <!-- Periksa halaman (gerbang memblokir kiriman): warga memeriksa/menekan sendiri, lalu AI boleh lanjut. -->
    <div class="flex flex-wrap gap-2">
      <button type="button" onclick={onkembalikan} data-sudah-lanjut class={TOMBOL_GELAP}>
        <Icon name="putar" class="size-[15px]" />Lanjutkan
      </button>
    </div>
  {/if}
{/snippet}

{#snippet sudahKirim()}
  <!-- AI berhenti: warga mengirim sendiri, lalu Urusin memeriksa halaman suksesnya lewat worker. -->
  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      onclick={onsudahkirim}
      disabled={data.memeriksaKirim}
      data-sudah-kirim
      class={TOMBOL_TERANG}>Saya sudah mengirim</button
    >
  </div>
  {#if data.pesanKirim}<p role="alert" class="text-[15px] text-galat">{data.pesanKirim}</p>{/if}
{/snippet}

<section
  aria-label="Browser Pendamping"
  class="flex h-full min-h-[32rem] flex-col overflow-clip rounded-2xl border border-line bg-surface shadow-[0_4px_16px_#0000000d] lg:min-h-0"
>
  <!-- Bilah atas (Top bar): gembok + domain resmi + instansi, chip mode di kanan -->
  <div class="flex min-h-[55.5px] shrink-0 items-center gap-2.5 border-b border-line bg-card px-4">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Icon name="gembok" class="size-4 shrink-0 text-ink" label="Koneksi aman" />
      <span class="truncate text-[15px] font-semibold text-ink">{domain(data.situs?.origin ?? situs)}</span>
      {#if data.situs?.replika}
        <!-- Mode Uji: yang terbuka replika uji milik Urusin dengan data contoh, bukan situs pemerintah asli. -->
        <span
          data-label-simulasi
          class="shrink-0 rounded-full border border-kuning-garis bg-kuning-lembar px-2 py-0.5 text-xs font-semibold text-ink"
          title="Simulasi di replika dengan data contoh, bukan situs pemerintah asli">Simulasi</span
        >
      {:else if instansi}<span class="hidden truncate text-sm text-card-ink sm:inline">{instansi}</span>{/if}
    </div>
    <ChipMode keadaan={k} />
    <button
      type="button"
      aria-label="Tutup Browser Pendamping"
      aria-busy={menutup}
      disabled={menutup}
      onclick={ontutup}
      class="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-ink hover:bg-bg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-60"
    >
      <Icon name={menutup ? 'memuat' : 'tutup'} class="size-4.5" />
      <span class="hidden sm:inline">{menutup ? 'Menutup…' : 'Tutup'}</span>
    </button>
  </div>

  {#if data.pesan === PESAN_GAGAL_TUTUP}
    <p role="alert" class="shrink-0 border-b border-line bg-card px-4 py-3 text-sm text-galat">
      {data.pesan}
    </p>
  {/if}

  {#if k === 'giliran' && data.giliran}
    <!-- Giliran Anda sheet (App 07) -->
    <div
      role="status"
      class="flex shrink-0 gap-3.5 border-b border-kuning-garis bg-kuning-lembar px-[18px] py-3.5"
    >
      <span class="grid size-[34px] shrink-0 place-items-center rounded-full bg-kuning text-kuning-ink">
        <Icon name="tangan" class="size-[17px]" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <p class="text-[17px] leading-normal font-bold text-ink">
          {judulGiliran}
        </p>
        {#if isiGiliran}<p class="text-[15px] leading-[23px] text-muted">{isiGiliran}</p>{/if}
      </div>
    </div>
  {:else if k === 'siaga'}
    <!-- Siaga: langkah selesai, peramban server masih hidup sebentar (hasil tetap terbaca di siaran). -->
    <div
      role="status"
      data-siaga
      class="flex shrink-0 flex-wrap items-center gap-3.5 border-b border-line bg-bg-2 px-[18px] py-3.5"
    >
      <span class="grid size-[34px] shrink-0 place-items-center rounded-full bg-hijau text-hijau-ink">
        <Icon name="centang" class="size-[17px]" />
      </span>
      <div class="flex min-w-[min(100%,14rem)] flex-1 basis-56 flex-col gap-1.5">
        <p class="text-[17px] leading-normal font-bold text-ink">
          {#if data.bukti?.nomor}Nomor permohonan <span class="font-mono">{data.bukti.nomor}</span
            >{:else}Langkah ini selesai{/if}
        </p>
        <p class="text-[15px] leading-[23px] text-muted">
          Browser masih terbuka sebentar untuk langkah berikutnya, lalu ditutup otomatis bersama login dan
          cookie-nya.
        </p>
      </div>
      <button type="button" onclick={ontutup} class={TOMBOL_TERANG}>Tutup sekarang</button>
    </div>
  {/if}

  <!-- Siaran layar: canvas selalu ada agar viewer bisa menggambar; keadaan lain menutupinya. -->
  <!-- Di HP situs dirender seukuran layar ponsel: area siaran setinggi ~85dvh supaya skalanya ≥0,85 (terbaca). -->
  <div class="relative min-h-0 flex-1 bg-siaran max-lg:min-h-[85dvh]">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="absolute inset-0" onpointerup={ketuk}>
      <canvas
        bind:this={canvas}
        class="block h-full w-full touch-none {siaran ? '' : 'invisible'}"
        aria-label="Layar situs resmi dari Browser Pendamping"
        tabindex={takeover ? 0 : -1}
      ></canvas>
    </div>
    <textarea
      bind:this={inputTeks}
      aria-label="Ketik di situs resmi"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      class="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      tabindex="-1"></textarea>

    {#if k === 'menyiapkan' || k === 'mati'}
      <!-- 02 Menyiapkan browser: kerangka, bukan spinner kosong -->
      <div class="absolute inset-0 flex flex-col items-start gap-3 overflow-hidden bg-siaran p-5">
        <span class="h-7 w-full shrink-0 animate-pulse rounded-md bg-kerangka" aria-hidden="true"></span>
        <span class="h-4 w-[220px] max-w-full shrink-0 rounded-md bg-kerangka-2" aria-hidden="true"></span>
        <span class="h-2.5 w-40 shrink-0 rounded-md bg-kerangka-2 opacity-70" aria-hidden="true"></span>
        {#each [0, 1] as baris (baris)}
          <div class="flex w-full shrink-0 gap-3" aria-hidden="true">
            <span class="h-[34px] flex-1 rounded-[7px] bg-kerangka-2"></span>
            <span class="h-[34px] flex-1 rounded-[7px] bg-kerangka-2"></span>
          </div>
        {/each}
        <p role="status" class="text-[13px] text-card-ink">Menyiapkan browser khusus urusan ini…</p>
      </div>
    {:else if !siaran}
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-siaran p-5"
      >
        {#if k === 'antre'}
          <span class="{LINGKAR} bg-bg-2 text-muted"><Icon name="antre" class="size-[21.6px]" /></span>
          <p class="text-2xl leading-normal font-bold text-ink">Anda nomor {data.antrean?.posisi ?? 1}</p>
          <p class={TEKS}>Satu sesi paling lama 15 menit. Boleh ditinggal, kami kabari saat siap.</p>
          <button type="button" onclick={onhentikan} class={TOMBOL_TERANG}>Batalkan antrean</button>
        {:else if k === 'selesai'}
          <span class="grid size-14 place-items-center rounded-full bg-hijau text-hijau-ink"
            ><Icon name="centang" class="size-[25.2px]" /></span
          >
          {#if data.bukti?.nomor}
            <p class="text-[13px] text-muted">Nomor permohonan</p>
            <p class="font-mono text-xl font-semibold text-ink">{data.bukti.nomor}</p>
          {:else}
            <p class={JUDUL}>Pengajuan terkirim</p>
          {/if}
          {#if data.mode === 'done'}
            <!-- Hanya saat sesi benar-benar ditutup (mode done), bukan saat siaga. -->
            <p class="text-center text-[13px] text-card-ink">
              Browser ditutup. Login dan cookie ikut dihapus.
            </p>
          {/if}
        {:else if k === 'kedaluwarsa'}
          <span class="{LINGKAR} bg-bg-2 text-muted"><Icon name="waktu-habis" class="size-[21.6px]" /></span>
          <p class={JUDUL}>Sesi berakhir</p>
          <p class={TEKS}>Terlalu lama tidak aktif. Data urusan Anda aman.</p>
          <button type="button" onclick={onmulailagi} class={TOMBOL_GELAP}
            ><Icon name="ulang" class="size-[15px]" />Mulai lagi</button
          >
        {:else if k === 'dipandu' || k === 'tidak_tersedia'}
          <span class="{LINGKAR} bg-merah text-galat"><Icon name="peta" class="size-[21.6px]" /></span>
          <p class="text-center text-lg leading-normal font-bold text-ink">
            {k === 'dipandu' ? 'Situs menolak Browser Pendamping' : 'Browser Pendamping belum tersedia'}
          </p>
          <p class="{TEKS} max-w-[330px]">
            {data.pesan ??
              'Buka situs resmi sendiri. Urusin menunjukkan langkahnya, data yang perlu disalin, dan berkas yang perlu diunggah.'}
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <button type="button" onclick={onpanduan} class={TOMBOL_GELAP}
              ><Icon name="panah" class="size-[15px]" />Buka panduan</button
            >
            {#if onsimulasi}
              <!-- Demo juri: situs asli tidak bisa dibuka dari server, simulasi di replika tetap tersedia. -->
              <button type="button" onclick={onsimulasi} data-simulasi class={TOMBOL_TERANG}
                ><Icon name="ai" class="size-[15px]" />Lihat contoh pengisian (simulasi)</button
              >
            {/if}
          </div>
        {:else if k === 'berakhir'}
          <!-- Sesi hilang di tengah jalan (worker restart, jaringan, timeout): bukan jalan buntu. -->
          <span class="{LINGKAR} bg-bg-2 text-muted"><Icon name="terputus" class="size-[21.6px]" /></span>
          <p class={JUDUL}>Sesi Browser Pendamping berakhir</p>
          <p role="status" class={TEKS}>{data.pesan ?? 'Koneksi ke peramban pendamping terputus.'}</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button type="button" onclick={onmulailagi} data-buka-lagi class={TOMBOL_GELAP}
              ><Icon name="ulang" class="size-[15px]" />Buka lagi situsnya</button
            >
            <button type="button" onclick={onpanduan} data-buka-panduan class={TOMBOL_TERANG}
              ><Icon name="peta" class="size-[15px]" />Buka panduan</button
            >
          </div>
        {:else if k === 'galat'}
          <span class="{LINGKAR} bg-merah text-galat"><Icon name="peringatan" class="size-[21.6px]" /></span>
          <p class={JUDUL}>AI berhenti</p>
          <p class={TEKS}>{data.pesan ?? 'Tidak ada yang dikirim. Coba lagi sebentar lagi.'}</p>
          <button type="button" onclick={onmulailagi} class={TOMBOL_GELAP}
            ><Icon name="ulang" class="size-[15px]" />Coba lagi</button
          >
        {/if}
      </div>
    {:else if k === 'terputus'}
      <!-- 10 Koneksi putus -->
      <div
        role="status"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-siaran p-5"
      >
        <span class="{LINGKAR} bg-bg-2 text-muted"><Icon name="terputus" class="size-[21.6px]" /></span>
        <p class={JUDUL}>Menyambung ulang…</p>
        <p class={TEKS}>Otomatis lanjut dari kolom terakhir.</p>
        <span class="h-1 w-[200px] overflow-hidden rounded-sm bg-kerangka-2" aria-hidden="true">
          <span class="block h-full w-[90px] rounded-sm bg-card-ink"></span>
        </span>
      </div>
    {/if}
  </div>

  <!-- Bilah bawah (Bottom bar): progres + Ambil alih + Hentikan. Di HP lengket di bawah layar: kartu giliran di atas
       siaran bisa tergulir keluar, jadi instruksi "Giliran Anda" selalu terlihat di sini. -->
  {#if k === 'giliran' && data.giliran}
    <div
      data-bilah-bawah
      data-bilah-giliran
      class="flex shrink-0 flex-col gap-2.5 border-t border-kuning-garis bg-kuning-lembar px-4 py-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10"
    >
      <p
        role="status"
        data-instruksi-giliran
        class="flex items-start gap-2 text-[15px] font-semibold text-ink"
      >
        <Icon name="tangan" class="mt-0.5 size-4 shrink-0" />
        <span>Giliran Anda: {instruksiGiliran(data.giliran)}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        {@render aksiGiliran(data.giliran)}
        {#if onsimulasi}
          <!-- Demo juri: simulasi pengisian di replika (data contoh), bukan situs resmi asli. -->
          <button type="button" onclick={onsimulasi} data-simulasi class={TOMBOL_TERANG}>
            <Icon name="ai" class="size-[15px]" />Lihat contoh pengisian (simulasi)
          </button>
        {/if}
        <button
          type="button"
          onclick={onhentikan}
          class="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full border border-galat bg-surface px-3.5 text-sm font-semibold whitespace-nowrap text-galat hover:bg-merah"
        >
          <Icon name="jeda" class="size-4" />Hentikan
        </button>
      </div>
    </div>
  {:else if k === 'ai' || k === 'giliran'}
    <div
      data-bilah-bawah
      class="flex min-h-[75.5px] shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-line bg-card px-4 py-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10"
    >
      <div class="flex min-w-[10rem] flex-1 flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <span class="truncate text-[15px] font-semibold text-ink">{labelKerjaAi(data.langkah)}</span>
          {#if data.langkah}<span class="shrink-0 text-sm whitespace-nowrap text-card-ink"
              >{data.langkah.indeks + 1} dari {data.langkah.total}</span
            >{/if}
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-[3px] bg-line"
          role="progressbar"
          aria-label="Kemajuan pengisian"
          aria-valuenow={persen}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="h-full rounded-[3px] bg-nila-ink" style="width: {persen}%"></div>
        </div>
      </div>
      {#if k === 'ai'}
        <button
          type="button"
          onclick={onambilalih}
          class="inline-flex h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-[18px] text-base font-semibold whitespace-nowrap text-ink hover:bg-card"
        >
          <Icon name="tangan" class="size-[17px]" />Ambil alih
        </button>
      {/if}
      <button
        type="button"
        onclick={onhentikan}
        class="inline-flex h-12 items-center gap-2 rounded-full border border-galat bg-surface px-[18px] text-base font-semibold whitespace-nowrap text-galat hover:bg-merah"
      >
        <Icon name="jeda" class="size-[17px]" />Hentikan
      </button>
    </div>
  {:else if k === 'dijeda'}
    <!-- Dijeda: warga memegang kendali. Status ringkas yang lengket di HP; Batalkan di menu ⋯ agar tidak memakan
         layar. Di 390 px: instruksi + ⋯ satu baris, dua tombol berbagi satu baris. -->
    <div
      data-bilah-bawah
      class="flex shrink-0 flex-col gap-2 border-t border-kuning-garis bg-kuning-lembar px-4 py-2.5 max-lg:sticky max-lg:bottom-0 max-lg:z-10"
    >
      <div class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            role="status"
            data-instruksi-giliran
            class="flex items-start gap-2 text-[15px] font-semibold text-ink"
          >
            <Icon name="tangan" class="mt-0.5 size-4 shrink-0" />
            <span>Giliran Anda: {instruksiGiliran(null)}.</span>
          </p>
          <p class="text-sm leading-5 text-muted">Yang Anda ketik tidak dicatat dan tidak dilihat AI.</p>
        </div>
        <details class="relative shrink-0">
          <summary
            aria-label="Pilihan lain"
            class="-my-1 grid size-11 cursor-pointer list-none place-items-center rounded-full text-lg font-bold text-ink hover:bg-bg-2 [&::-webkit-details-marker]:hidden"
            >⋯</summary
          >
          <div
            class="absolute right-0 bottom-full z-20 mb-2 min-w-40 rounded-xl border border-line bg-surface p-1 shadow-[0_4px_16px_#0000001f]"
          >
            <button
              type="button"
              onclick={onhentikan}
              data-batalkan
              class="flex h-11 w-full items-center rounded-lg px-3 text-left text-[15px] font-semibold text-galat hover:bg-merah"
              >Batalkan</button
            >
          </div>
        </details>
      </div>
      {#if data.pesanKirim}<p role="alert" class="text-sm text-galat">{data.pesanKirim}</p>{/if}
      <div class="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap">
        <button
          type="button"
          onclick={onkembalikan}
          data-minta-ai
          class="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line-2 bg-surface px-3 py-1.5 text-center text-sm leading-tight font-semibold text-ink hover:bg-card"
        >
          <Icon name="ai" class="size-4 shrink-0" />{data.situs?.lihatSaja
            ? 'Minta AI lanjut melihat'
            : 'Minta AI bantu mengisi'}
        </button>
        {#if !data.situs?.lihatSaja}
          <button
            type="button"
            onclick={onsudahkirim}
            disabled={data.memeriksaKirim}
            data-sudah-kirim
            class="inline-flex min-h-11 items-center justify-center rounded-full bg-primer px-3 py-1.5 text-center text-sm leading-tight font-semibold text-primer-ink disabled:opacity-60"
            >Saya sudah mengirim</button
          >
        {/if}
      </div>
    </div>
  {/if}
</section>
