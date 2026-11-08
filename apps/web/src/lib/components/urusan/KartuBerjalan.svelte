<script lang="ts">
  import { resolve } from '$app/paths';
  import { findPeristiwa, URUSAN_LAIN } from '#lib/peristiwa.js';
  import { infoStatus } from '#lib/urusan-status.js';
  import Titik from '../ui/Titik.svelte';
  import type { UrusanBerjalan } from './daftar.svelte.js';

  /** Kartu "Urusan berjalan" di Beranda: avatar pendamping, judul, status titik, satu tombol. */
  let { urusan, utama = false }: { urusan: UrusanBerjalan; utama?: boolean } = $props();

  const p = $derived(findPeristiwa(urusan.peristiwa ?? '') ?? URUSAN_LAIN);
  const info = $derived(infoStatus(urusan.ringkasan?.state));
</script>

<article
  class="flex flex-col gap-4 rounded-kartu p-4 {utama
    ? 'border-[1.5px] border-ink bg-surface'
    : 'border border-line bg-card'}"
>
  <div class="flex items-center gap-3">
    <img src={p.avatar} alt="" width="40" height="40" class="size-10 shrink-0 rounded-full" />
    <div class="min-w-0">
      <h3 class="truncate text-base font-semibold tracking-tight text-ink">{urusan.judul}</h3>
      <Titik nada={info.nada}>{urusan.ringkasan ? info.label : 'Memuat status…'}</Titik>
    </div>
  </div>
  <a
    href={resolve('/urusan/[id]', { id: urusan.id })}
    class="flex min-h-12 items-center justify-center rounded-full text-[0.9375rem] font-semibold {utama
      ? 'bg-primer text-primer-ink hover:opacity-90'
      : 'border border-line-2 bg-surface text-ink hover:bg-card'}"
  >
    {utama ? info.aksi : 'Lihat detail'}
    <span class="sr-only">: {urusan.judul}</span>
  </a>
</article>
