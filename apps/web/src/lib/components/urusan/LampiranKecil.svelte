<script lang="ts">
  import Icon from '../Icon.svelte';
  import { ukuranBerkas, type Lampiran } from './komposer.js';

  /**
   * Lampiran yang belum terkirim sebagai ubin kecil bernomor (#1, #2, ...): nomor yang sama dipakai AI saat menyebut
   * foto. Tanpa pilihan jenis dokumen (keputusan pemilik 2026-11-14). Dipakai komposer urusan dan Beranda.
   */
  let { lampiran, onhapus }: { lampiran: Lampiran[]; onhapus: (kunci: string) => void } = $props();
</script>

<ul aria-label="Lampiran" class="flex flex-wrap gap-2">
  {#each lampiran as l, i (l.kunci)}
    <li
      data-lampiran
      class="relative size-14 shrink-0"
      title="{l.berkas.name} · {ukuranBerkas(l.berkas.size)}"
    >
      {#if l.pratinjau}
        <img
          src={l.pratinjau}
          alt="Lampiran #{i + 1}: {l.berkas.name}"
          class="size-14 rounded-xl border border-line-2 bg-bg-2 object-cover shadow-[0_0_0.5px_#0000000f,0_1px_0.5px_#0000000f]"
        />
      {:else}
        <span
          class="flex size-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-line-2 bg-bg-2 text-ink"
        >
          <Icon name="berkas-teks" class="size-5" />
          <span class="text-[10px] leading-none font-semibold text-muted">PDF</span>
          <span class="sr-only">Lampiran #{i + 1}: {l.berkas.name}</span>
        </span>
      {/if}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute bottom-1 left-1 rounded-md bg-ink/75 px-1 text-[10px] leading-4 font-semibold text-surface"
        >#{i + 1}</span
      >
      <button
        type="button"
        onclick={() => onhapus(l.kunci)}
        aria-label="Hapus lampiran #{i + 1}"
        class="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-line-2 bg-surface text-muted shadow-[0_1px_2px_#0000001a] hover:text-ink"
      >
        <Icon name="tutup" class="size-3" />
      </button>
    </li>
  {/each}
</ul>
