<script lang="ts">
  import { resolve } from '$app/paths';
  import { peristiwaDariJenis } from '#lib/peristiwa.js';
  import { LANGKAH_RENCANA, infoStatus, tanggal } from '#lib/urusan-status.js';
  import Chip from '../ui/Chip.svelte';
  import Lencana from './Lencana.svelte';
  import type { UrusanBerjalan } from './daftar.svelte.js';

  /** Card/Urusan (A34wi, App 10): lencana, judul, status, progres 5 langkah, chip status + satu tombol. */
  let { urusan, utama = false }: { urusan: UrusanBerjalan; utama?: boolean } = $props();

  const p = $derived(peristiwaDariJenis(urusan.peristiwa));
  const info = $derived(infoStatus(urusan.ringkasan?.state));
  const langkah = $derived(Math.min(info.langkah, 6));
  const CHIP = {
    anda: { nada: 'anda', ikon: 'tangan', teks: 'Menunggu Anda' },
    ai: { nada: 'ai', ikon: 'ai', teks: 'AI bekerja' },
    instansi: { nada: 'urusin', ikon: 'instansi', teks: 'Menunggu instansi' },
    selesai: { nada: 'hijau', ikon: 'centang-bulat', teks: 'Selesai' },
    netral: { nada: 'netral', ikon: 'info', teks: 'Berhenti' },
  } as const;
  const chip = $derived(CHIP[info.nada]);
</script>

<article
  class="flex flex-col gap-4 rounded-kartu p-5 {utama
    ? 'border-[1.5px] border-ink bg-surface'
    : 'border border-line bg-card'}"
>
  <div class="flex items-start justify-between gap-3">
    <Lencana peristiwa={p} />
    <img src={p.avatar} alt="" width="36" height="36" class="size-9 rounded-full" />
  </div>
  <div>
    <h3 class="text-xl font-semibold tracking-tight text-ink">{urusan.judul}</h3>
    <p class="mt-1 text-base text-body">{urusan.ringkasan ? info.label : 'Status belum termuat'}</p>
  </div>
  <div>
    <div class="flex justify-between gap-3 text-sm text-muted">
      <span>
        {#if langkah >= 1 && langkah <= 5}Langkah {langkah} dari 5{:else if langkah > 5}Semua langkah selesai{:else}Rencana
          sedang disusun{/if}
      </span>
      {#if urusan.ringkasan}<span>Diperbarui {tanggal(urusan.ringkasan.diubahPada)}</span>{/if}
    </div>
    <div class="mt-2 grid grid-cols-5 gap-1.5" aria-hidden="true">
      {#each LANGKAH_RENCANA as _, i (i)}
        <span
          class="h-1.5 rounded-full {langkah > 5
            ? 'bg-hijau-ink'
            : i + 1 < langkah
              ? 'bg-ink'
              : i + 1 === langkah
                ? 'bg-brand'
                : 'bg-line'}"
        ></span>
      {/each}
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <Chip nada={chip.nada} ikon={chip.ikon} besar>{chip.teks}</Chip>
    <a
      href={resolve('/urusan/[id]', { id: urusan.id })}
      class="inline-flex min-h-12 items-center rounded-full px-5 text-[0.9375rem] font-semibold {utama
        ? 'bg-primer text-primer-ink hover:opacity-90'
        : 'border border-line-2 bg-surface text-ink hover:bg-bg'}"
    >
      {info.aksi}<span class="sr-only">: {urusan.judul}</span>
    </a>
  </div>
</article>
