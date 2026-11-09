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

<section aria-label="Pengajuan terkirim" class="overflow-hidden rounded-[18px] border border-line bg-surface">
  <p class="flex items-center gap-2.5 bg-hijau px-4 py-4 text-[17px] font-bold text-hijau-ink sm:px-5">
    <Icon name="centang-bulat" class="size-5" /> Pengajuan terkirim
  </p>
  {#if nomor}
    <div class="flex flex-col gap-1.5 px-4 py-[18px] sm:px-5">
      <p class="text-sm text-card-ink">Nomor permohonan</p>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="font-mono text-xl font-semibold text-ink sm:text-2xl">{nomor}</p>
        <button
          type="button"
          onclick={salin}
          class="inline-flex h-11 items-center gap-1.5 rounded-full border border-line-2 bg-surface px-3.5 text-[15px] font-semibold text-ink hover:bg-card"
        >
          <Icon name={tersalin ? 'centang' : 'salin'} class="size-4" />
          {tersalin ? 'Tersalin' : 'Salin'}
        </button>
      </div>
    </div>
  {/if}
  <div class="flex flex-col gap-3 border-t border-line px-4 py-4 sm:px-5">
    <p class="text-sm font-semibold text-card-ink">Langkah berikutnya</p>
    <ul class="flex flex-col gap-3 text-base leading-[23px] text-ink">
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
  </div>
  <div class="flex flex-wrap gap-2.5 px-4 pt-1 pb-5 sm:px-5">
    <a
      href={resolve('/jejak/[id]', { id: urusanId })}
      class="inline-flex h-[46px] items-center gap-2 rounded-full border border-line-2 bg-surface px-[18px] text-base font-semibold text-ink hover:bg-card"
    >
      <Icon name="jejak" class="size-4" /> Lihat jejak
    </a>
    {#if situs}
      <a
        href={situs}
        target="_blank"
        rel="external noopener noreferrer"
        class="inline-flex h-[46px] items-center gap-2 rounded-full border border-line-2 bg-surface px-[18px] text-base font-semibold text-ink hover:bg-card"
      >
        <Icon name="keluar" class="size-4" /> Cek di situs resmi
      </a>
    {/if}
  </div>
</section>
