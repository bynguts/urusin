<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '../Icon.svelte';
  import ChipMode from './ChipMode.svelte';
  import type { DataPendamping } from '#lib/pendamping/sesi.svelte.js';
  import { domain } from '#lib/urusan-status.js';

  /**
   * Browser Pendamping (App 06/07 + papan keadaan): bilah atas gembok + domain resmi + instansi + chip mode,
   * banner giliran/takeover, siaran canvas, dan bilah bawah progres + Ambil alih + Hentikan (≥ 48 px).
   * Komponen ini hanya tampilan; canvas dan input tersembunyi diikat ke pemanggil yang memegang viewer.
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
    urusanId,
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
    /** Id urusan untuk tautan Jejak "Tinjau riwayat tindakan" di keadaan dipandu. */
    urusanId?: string | undefined;
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

  const CATATAN_GILIRAN: Record<string, string> = {
    login: 'Jangan kirim OTP atau sandi ke percakapan Urusin. Agen menunggu sampai Anda selesai.',
    masuk_akun: 'Jangan kirim OTP atau sandi ke percakapan Urusin. Agen menunggu sampai Anda selesai.',
    verifikasi_situs: 'Situs memeriksa keamanan. Centang kotaknya sendiri.',
    final: 'AI dikunci agar tidak bisa menekan Kirim.',
    periksa: 'AI menunggu sampai Anda selesai.',
  };
  const CATATAN_UMUM =
    'Jangan kirim kode atau sandi ke percakapan Urusin. Agen menunggu sampai Anda selesai.';

  function ketuk() {
    // Keyboard ponsel: fokuskan input tersembunyi saat warga mengetuk siaran dalam mode takeover.
    if (takeover) inputTeks?.focus();
  }
</script>

<section
  aria-label="Browser Pendamping"
  class="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lembut"
>
  <!-- Bilah atas: domain resmi selalu terlihat -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-3 bg-card px-4 py-3">
    <Icon name="gembok" class="size-4.5 shrink-0 text-ink" label="Koneksi aman" />
    <span class="font-semibold text-ink">{domain(situs)}</span>
    {#if instansi}<span class="hidden text-sm text-body sm:inline">{instansi}</span>{/if}
    <span class="ml-auto"><ChipMode keadaan={k} /></span>
  </div>

  {#if k === 'giliran' && data.giliran}
    <!-- Frame rFa2b: "Bantuan dijeda · Sekarang, giliran Anda." -->
    <div role="status" class="border-b border-line bg-bg-2 px-6 py-6">
      <Icon name="tangan" class="size-7 text-kuning-ink" />
      <span
        class="mt-5 inline-flex h-8 w-fit items-center rounded-full bg-kuning px-3 text-[0.8125rem] font-semibold text-kuning-ink"
        >Bantuan dijeda</span
      >
      <p class="mt-4 text-[1.625rem] leading-[1.15] font-normal tracking-[-0.035em] text-ink">
        Sekarang,<br />giliran Anda.
      </p>
      <p class="mt-5 text-[1.0625rem] leading-[1.6] text-ink">{data.giliran.pesan}</p>
      <div class="mt-4 rounded-xl bg-surface px-5 py-5 text-[0.9375rem] leading-[1.6] text-muted">
        <Icon name="gembok" class="size-5 text-ink" />
        <p class="mt-3">{CATATAN_GILIRAN[data.giliran.alasan] ?? CATATAN_UMUM}</p>
      </div>
      <button
        type="button"
        onclick={onkembalikan}
        class="mt-5 inline-flex h-[3.25rem] w-full items-center justify-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="panah" class="size-[1.125rem]" /> Saya sudah selesai
      </button>
      <button
        type="button"
        onclick={onhentikan}
        class="mt-5 inline-flex min-h-12 items-center text-base font-semibold text-ink hover:opacity-70"
        >Hentikan bantuan</button
      >
      <p class="mt-4 text-[0.8125rem] leading-[1.6] text-muted">
        Login, CAPTCHA, OTP, dan pengiriman akhir selalu dilakukan oleh Anda.
      </p>
    </div>
  {:else if k === 'dijeda'}
    <div role="status" class="flex flex-wrap items-center gap-3 border-b border-line-3 bg-bg-2 px-4 py-3">
      <Icon name="jeda" class="size-5 shrink-0" />
      <p class="min-w-0 flex-1 text-[0.9375rem] text-ink">
        <strong class="font-semibold">AI berhenti.</strong> Yang Anda ketik tidak dicatat dan tidak dilihat AI.
      </p>
      <button
        type="button"
        onclick={onkembalikan}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="putar" class="size-4" /> Kembalikan ke AI
      </button>
    </div>
  {/if}

  <!-- Siaran: canvas selalu ada agar viewer bisa menggambar; keadaan lain menutupinya. -->
  <div class="relative min-h-0 flex-1 bg-[#f2f2ef]">
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

    {#if !siaran}
      <div class="absolute inset-0 grid place-items-center overflow-y-auto bg-bg-2 p-6 text-center">
        <div class="flex max-w-sm flex-col items-center gap-3">
          {#if k === 'antre'}
            <span class="grid size-12 place-items-center rounded-full bg-surface"
              ><Icon name="antre" class="size-6" /></span
            >
            <p class="text-2xl font-semibold tracking-tight text-ink">
              Anda nomor {data.antrean?.posisi ?? 1}
            </p>
            <p class="text-[0.9375rem] text-body">
              Satu sesi paling lama 15 menit. Boleh ditinggal, kami kabari saat siap.
            </p>
            <button
              type="button"
              onclick={onhentikan}
              class="mt-1 inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
              >Batalkan antrean</button
            >
          {:else if k === 'menyiapkan' || k === 'mati'}
            <div class="flex w-full flex-col gap-3" aria-hidden="true">
              <span class="h-7 w-full animate-pulse rounded-lg bg-line"></span>
              <span class="h-4 w-1/2 animate-pulse rounded bg-line"></span>
              <div class="grid grid-cols-2 gap-3">
                <span class="h-9 animate-pulse rounded-lg bg-line"></span>
                <span class="h-9 animate-pulse rounded-lg bg-line"></span>
              </div>
            </div>
            <p role="status" class="text-[0.9375rem] text-body">Menyiapkan browser khusus urusan ini…</p>
          {:else if k === 'selesai'}
            <span class="grid size-14 place-items-center rounded-full bg-hijau text-hijau-ink"
              ><Icon name="centang" class="size-7" /></span
            >
            {#if data.bukti?.nomor}
              <p class="text-sm text-muted">Nomor permohonan</p>
              <p class="font-mono text-2xl tracking-wide text-ink">{data.bukti.nomor}</p>
            {:else}
              <p class="text-xl font-semibold text-ink">Pengajuan terkirim</p>
            {/if}
            <p class="text-[0.9375rem] text-body">Browser ditutup. Login dan cookie ikut dihapus.</p>
          {:else if k === 'kedaluwarsa'}
            <span class="grid size-12 place-items-center rounded-full bg-surface"
              ><Icon name="waktu-habis" class="size-6" /></span
            >
            <p class="text-xl font-semibold text-ink">Sesi berakhir</p>
            <p class="text-[0.9375rem] text-body">Terlalu lama tidak aktif. Data urusan Anda aman.</p>
            <button
              type="button"
              onclick={onmulailagi}
              class="mt-1 inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 font-semibold text-primer-ink hover:opacity-90"
              ><Icon name="ulang" class="size-4.5" />Mulai lagi</button
            >
          {:else if k === 'dipandu' || k === 'tidak_tersedia'}
            <!-- Frame rFa2b: "Perlu cara manual · Kita lanjut dengan panduan." -->
            <div class="flex w-full flex-col text-left">
              <Icon name="rute" class="size-7 text-hijau-ink" />
              <span
                class="mt-6 inline-flex h-8 w-fit items-center rounded-full bg-bg-2 px-3 text-[0.8125rem] font-semibold text-muted"
                >Perlu cara manual</span
              >
              <p class="mt-4 text-[1.625rem] leading-[1.15] font-normal tracking-[-0.035em] text-ink">
                Kita lanjut<br />dengan panduan.
              </p>
              <p class="mt-5 text-[1.0625rem] leading-[1.6] text-ink">
                {data.pesan ??
                  'Tampilan situs berubah atau layanan ini belum didukung. Pengisian otomatis dihentikan.'}
              </p>
              <p class="mt-4 text-[0.9375rem] leading-[1.6] text-muted">
                Rencana dan berkas yang sudah Anda siapkan tetap bisa digunakan. Urusin membantu menjelaskan
                langkah di situs resmi.
              </p>
              <button
                type="button"
                onclick={onpanduan}
                class="mt-6 inline-flex h-[3.25rem] items-center justify-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90"
                ><Icon name="panah" class="size-[1.125rem]" />Lihat langkah manual</button
              >
              {#if urusanId}
                <a
                  href={resolve('/jejak/[id]', { id: urusanId })}
                  class="mt-5 inline-flex h-[3.25rem] items-center rounded-full bg-surface px-4 text-base font-semibold text-ink shadow-lembut hover:opacity-90"
                  >Tinjau riwayat tindakan</a
                >
              {/if}
              <p class="mt-6 text-[0.8125rem] leading-[1.6] text-muted">
                Tidak ada percobaan ulang otomatis tanpa Anda mengetahuinya.
              </p>
            </div>
          {:else if k === 'galat'}
            <span class="grid size-12 place-items-center rounded-full bg-mawar text-galat"
              ><Icon name="peringatan" class="size-6" /></span
            >
            <p class="text-xl font-semibold text-ink">AI berhenti dengan aman</p>
            <p class="text-[0.9375rem] text-body">
              {data.pesan ?? 'Tidak ada yang dikirim. Coba lagi sebentar lagi.'}
            </p>
            <button
              type="button"
              onclick={onmulailagi}
              class="mt-1 inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 font-semibold text-primer-ink hover:opacity-90"
              ><Icon name="ulang" class="size-4.5" />Coba lagi</button
            >
          {/if}
        </div>
      </div>
    {:else if k === 'terputus'}
      <div role="status" class="absolute inset-0 grid place-items-center bg-bg-2/90 p-6 text-center">
        <div class="flex flex-col items-center gap-3">
          <span class="grid size-12 place-items-center rounded-full bg-surface"
            ><Icon name="terputus" class="size-6" /></span
          >
          <p class="text-xl font-semibold text-ink">Menyambung ulang…</p>
          <p class="text-[0.9375rem] text-body">Otomatis lanjut dari kolom terakhir.</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- Bilah bawah -->
  {#if siaran || k === 'antre' || k === 'menyiapkan'}
    <div class="flex flex-wrap items-center gap-3 border-t border-line-3 bg-surface px-4 py-3">
      <div class="min-w-[10rem] flex-1">
        <div class="flex items-baseline justify-between gap-2 text-[0.9375rem]">
          <span class="font-semibold text-ink">
            {#if k === 'giliran' && data.giliran?.alasan === 'final'}Formulir terisi · AI menunggu Anda{:else if data.langkah}{data
                .langkah.label}{:else}Mengisi formulir{/if}
          </span>
          {#if data.langkah}<span class="text-sm text-muted"
              >{data.langkah.indeks + 1} dari {data.langkah.total}</span
            >{/if}
        </div>
        <div
          class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Kemajuan pengisian"
          aria-valuenow={persen}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full {k === 'giliran' ? 'bg-[#2f6b4f]' : 'bg-nila-ink'}"
            style="width: {persen}%"
          ></div>
        </div>
      </div>
      {#if k === 'ai'}
        <button
          type="button"
          onclick={onambilalih}
          class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
        >
          <Icon name="tangan" class="size-4.5" /> Ambil alih
        </button>
      {/if}
      {#if k !== 'giliran'}<button
          type="button"
          onclick={onhentikan}
          class="inline-flex min-h-12 items-center gap-2 rounded-full border border-galat-garis/70 bg-surface px-5 font-semibold text-galat hover:bg-mawar"
        >
          <Icon name="jeda" class="size-4.5" /> Hentikan
        </button>{/if}
    </div>
  {/if}
</section>
