<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '../Icon.svelte';
  import ChipMode from './ChipMode.svelte';
  import type { DataPendamping } from '#lib/pendamping/sesi.svelte.js';
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
    onhentikan,
    onmulailagi,
    onpanduan,
  }: {
    data: DataPendamping;
    situs: string;
    instansi?: string | undefined;
    canvas?: HTMLCanvasElement | null;
    inputTeks?: HTMLTextAreaElement | null;
    onambilalih: () => void;
    onkembalikan: () => void;
    onhentikan: () => void;
    onmulailagi: () => void;
    onpanduan: () => void;
  } = $props();

  const k = $derived(data.keadaan);
  const siaran = $derived(k === 'ai' || k === 'giliran' || k === 'dijeda' || k === 'terputus');
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
    final: 'Periksa isian, lalu tekan Kirim pengajuan',
    periksa: 'Periksa halaman ini',
    isi_sendiri: 'Isi kolom ini sendiri',
    berkas_kurang: 'Dokumen belum ada',
    ketuk_tautan: 'Buka formulir di situs',
  };
  const CATATAN_GILIRAN: Record<string, string> = {
    login: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    masuk_akun: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    verifikasi_situs: 'Situs memeriksa keamanan. Centang kotaknya sendiri.',
    final: 'AI dikunci agar tidak bisa menekan Kirim.',
    periksa: 'AI menunggu sampai Anda selesai.',
    isi_sendiri: 'Ketikan Anda tidak dibaca AI dan tidak dicatat.',
    berkas_kurang: 'Lanjutkan meminta izin Anda untuk mengunggah dokumen itu saja.',
    ketuk_tautan: 'AI tidak mengetuk tautan ini; Anda yang membukanya.',
  };
  const isiGiliran = $derived(
    data.giliran ? [data.giliran.pesan, CATATAN_GILIRAN[data.giliran.alasan]].filter(Boolean).join(' ') : '',
  );

  function ketuk() {
    // Keyboard ponsel: fokuskan input tersembunyi saat warga mengetuk siaran dalam mode takeover.
    if (takeover) inputTeks?.focus();
  }

  // Tombol papan u5rYk: tinggi 44, padding 0 16, jarak 7, 15/600.
  const TOMBOL_GELAP =
    'inline-flex h-11 items-center gap-[7px] rounded-full bg-primer px-4 text-[15px] font-semibold whitespace-nowrap text-primer-ink hover:opacity-90';
  const TOMBOL_TERANG =
    'inline-flex h-11 items-center gap-[7px] rounded-full border border-line-2 bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-ink hover:bg-card';
  const LINGKAR = 'grid size-12 shrink-0 place-items-center rounded-full';
  const JUDUL = 'text-xl leading-normal font-bold text-ink';
  const TEKS = 'w-full max-w-[280px] text-center text-sm leading-5 text-muted';
</script>

<section
  aria-label="Browser Pendamping"
  class="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_4px_16px_#0000000d]"
>
  <!-- Bilah atas (Top bar): gembok + domain resmi + instansi, chip mode di kanan -->
  <div class="flex min-h-[55.5px] shrink-0 items-center gap-2.5 border-b border-line bg-card px-4">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Icon name="gembok" class="size-4 shrink-0 text-ink" label="Koneksi aman" />
      <span class="truncate text-[15px] font-semibold text-ink">{domain(data.situs?.origin ?? situs)}</span>
      {#if data.situs?.replika}
        <!-- Mode Uji: yang terbuka replika uji milik Urusin, bukan situs pemerintah asli. -->
        <span
          class="shrink-0 rounded-full border border-kuning-garis bg-kuning-lembar px-2 py-0.5 text-xs font-semibold text-ink"
          title="Replika uji, bukan situs pemerintah asli">Mode uji</span
        >
      {:else if instansi}<span class="hidden truncate text-sm text-card-ink sm:inline">{instansi}</span>{/if}
    </div>
    <ChipMode keadaan={k} />
  </div>

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
          {JUDUL_GILIRAN[data.giliran.alasan] ?? 'Giliran Anda'}
        </p>
        {#if isiGiliran}<p class="text-[15px] leading-[23px] text-muted">{isiGiliran}</p>{/if}
        {#if ['isi_sendiri', 'berkas_kurang', 'ketuk_tautan'].includes(data.giliran.alasan)}
          <!-- Kolom di luar Data Diri (mis. nomor kitir), Dokumen yang belum ada, atau tautan pembuka formulir
               yang hanya boleh diketuk warga: warga, lalu AI lanjut. -->
          <div class="flex flex-wrap gap-2">
            {#if data.giliran.alasan === 'berkas_kurang'}
              <a href={resolve('/dokumen')} target="_blank" rel="noopener" class={TOMBOL_TERANG}
                >Buka Dokumen</a
              >
            {/if}
            <button type="button" onclick={onkembalikan} class={TOMBOL_GELAP}>
              <Icon name="putar" class="size-[15px]" />Lanjutkan
            </button>
          </div>
        {/if}
      </div>
    </div>
  {:else if k === 'dijeda'}
    <!-- Dijeda (papan 06): warga mengambil alih, AI berhenti sampai warga memilih Lanjutkan -->
    <div
      role="status"
      class="flex shrink-0 flex-wrap items-center gap-3.5 border-b border-line bg-bg-2 px-[18px] py-3.5"
    >
      <span class="grid size-[34px] shrink-0 place-items-center rounded-full bg-surface text-muted">
        <Icon name="jeda" class="size-[17px]" />
      </span>
      <div class="flex min-w-[min(100%,14rem)] flex-1 basis-56 flex-col gap-1.5">
        <p class="text-[17px] leading-normal font-bold text-ink">AI berhenti</p>
        <p class="text-[15px] leading-[23px] text-muted">
          Yang Anda ketik tidak dicatat dan tidak dilihat AI. Mau lanjut atau batalkan?
        </p>
      </div>
      <div class="flex gap-2">
        <button type="button" onclick={onkembalikan} class={TOMBOL_GELAP}>
          <Icon name="putar" class="size-[15px]" />Lanjutkan
        </button>
        <button type="button" onclick={onhentikan} class={TOMBOL_TERANG}>Batalkan</button>
      </div>
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
          <p class="text-center text-[13px] text-card-ink">Browser ditutup. Login dan cookie ikut dihapus.</p>
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
          <button type="button" onclick={onpanduan} class={TOMBOL_GELAP}
            ><Icon name="panah" class="size-[15px]" />Buka panduan</button
          >
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

  <!-- Bilah bawah (Bottom bar): progres + Ambil alih + Hentikan -->
  {#if k === 'ai' || k === 'giliran'}
    <div
      class="flex min-h-[75.5px] shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-line bg-card px-4 py-3"
    >
      <div class="flex min-w-[10rem] flex-1 flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <span class="truncate text-[15px] font-semibold text-ink">
            {#if k === 'giliran' && data.giliran?.alasan === 'final'}Formulir terisi · AI menunggu Anda{:else if data.langkah}{data
                .langkah.label}{:else}Mengisi formulir{/if}
          </span>
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
          <div
            class="h-full rounded-[3px] {k === 'giliran' ? 'bg-hijau-ink' : 'bg-nila-ink'}"
            style="width: {persen}%"
          ></div>
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
  {/if}
</section>
