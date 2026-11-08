<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '../Icon.svelte';

  /** Pengajuan terkirim (App 08): nomor permohonan bila terbaca, langkah berikutnya, Lihat jejak / Cek di situs resmi. */
  let {
    urusanId,
    nomor,
    situs,
  }: { urusanId: string; nomor?: string | undefined; situs?: string | null | undefined } = $props();

  let tersalin = $state(false);
  async function salin() {
    if (!nomor) return;
    try {
      await navigator.clipboard.writeText(nomor);
      tersalin = true;
      setTimeout(() => (tersalin = false), 2000);
    } catch {
      // clipboard ditolak: nomor tetap terlihat untuk disalin manual
    }
  }
</script>

<section aria-label="Pengajuan terkirim" class="overflow-hidden rounded-2xl border border-line bg-surface">
  <p
    class="flex items-center gap-2.5 bg-hijau px-4 py-3.5 text-[1.0625rem] font-semibold text-hijau-ink sm:px-5"
  >
    <Icon name="centang-bulat" class="size-5" /> Pengajuan terkirim
  </p>
  {#if nomor}
    <div class="flex flex-wrap items-center gap-3 border-b border-line-3 px-4 py-4 sm:px-5">
      <div class="min-w-0 flex-1">
        <p class="text-sm text-muted">Nomor permohonan</p>
        <p class="font-mono text-xl tracking-wide text-ink sm:text-2xl">{nomor}</p>
      </div>
      <button
        type="button"
        onclick={salin}
        class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-4 font-medium text-ink hover:bg-card"
      >
        <Icon name={tersalin ? 'centang' : 'salin'} class="size-4.5" />
        {tersalin ? 'Tersalin' : 'Salin'}
      </button>
    </div>
  {/if}
  <div class="px-4 py-4 sm:px-5">
    <p class="text-sm font-semibold text-ink">Langkah berikutnya</p>
    <ul class="mt-2 flex flex-col gap-2 text-[0.9375rem] text-ink">
      <li class="flex gap-2.5">
        <Icon name="instansi" class="mt-0.5 size-4.5 shrink-0 text-muted" />Petugas memverifikasi pengajuan
        Anda.
      </li>
      <li class="flex gap-2.5">
        <Icon name="lonceng" class="mt-0.5 size-4.5 shrink-0 text-muted" />Urusin memberi kabar saat status
        berubah.
      </li>
      <li class="flex gap-2.5">
        <Icon name="lokasi" class="mt-0.5 size-4.5 shrink-0 text-muted" />Bawa dokumen asli saat mengambil
        hasilnya.
      </li>
    </ul>
    <div class="mt-4 flex flex-wrap gap-3">
      <a
        href={resolve('/jejak/[id]', { id: urusanId })}
        class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
      >
        <Icon name="jejak" class="size-4.5" /> Lihat jejak
      </a>
      {#if situs}
        <a
          href={situs}
          target="_blank"
          rel="external noopener noreferrer"
          class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
        >
          <Icon name="keluar" class="size-4.5" /> Cek di situs resmi
        </a>
      {/if}
    </div>
  </div>
</section>
