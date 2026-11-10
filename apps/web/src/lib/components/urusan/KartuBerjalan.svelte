<script lang="ts">
  import { resolve } from '$app/paths';
  import { findPeristiwa, KELAS_WARNA, URUSAN_LAIN } from '#lib/peristiwa.js';
  import { infoStatus } from '#lib/urusan-status.js';
  import type { UrusanBerjalan } from './daftar.svelte.js';

  /**
   * Kartu "Urusan berjalan" App 01: avatar 40 bercincin putih, judul 17/600, titik status + teks 15,
   * satu tombol 44. Kartu utama (menunggu warga) bergaris gelap dengan tombol gelap.
   */
  let { urusan, utama = false }: { urusan: UrusanBerjalan; utama?: boolean } = $props();

  const p = $derived(findPeristiwa(urusan.peristiwa ?? '') ?? URUSAN_LAIN);
  const info = $derived(infoStatus(urusan.ringkasan?.state));
  const TITIK = {
    anda: 'bg-[#c8902e]',
    instansi: 'bg-[#9a958c]',
    ai: 'bg-nila-ink',
    selesai: 'bg-hijau-ink',
    netral: 'bg-[#9a958c]',
  } as const;
</script>

<article
  class="flex min-w-0 flex-1 flex-col gap-3.5 rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm {utama
    ? 'border-ink bg-surface'
    : 'border-line bg-card'}"
>
  <div class="flex items-center gap-3">
    <img
      src={p.avatar}
      alt=""
      width="40"
      height="40"
      class="size-10 shrink-0 rounded-full shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] ring-2 ring-surface {KELAS_WARNA[
        p.warna
      ]}"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <h3 class="truncate text-[17px] leading-6 font-semibold text-ink">{urusan.judul}</h3>
      <span class="inline-flex items-center gap-1.5 text-[15px] leading-[21px] text-card-ink">
        <span
          class="size-2 shrink-0 rounded-full {TITIK[info.nada]} {info.nada === 'anda' ? 'animasi-pulsa' : ''}"
          aria-hidden="true"
        ></span>
        {urusan.ringkasan ? info.label : 'Memuat status…'}
      </span>
    </div>
  </div>
  <a
    href={resolve('/urusan/[id]', { id: urusan.id })}
    class="flex h-11 items-center justify-center rounded-full text-base font-semibold {utama
      ? 'bg-primer text-primer-ink hover:opacity-90'
      : 'border border-line-2 bg-surface text-ink hover:bg-card'}"
  >
    {utama || info.nada !== 'instansi' ? info.aksi : 'Lihat detail'}
    <span class="sr-only">: {urusan.judul}</span>
  </a>
</article>
