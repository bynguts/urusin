<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../Icon.svelte';
  import { ambilTts } from '#lib/stores/app.svelte.js';

  /**
   * Bilah judul panel utama (Top bar App 02–14: tinggi 67.5, padding 0 28, garis bawah) dengan tombol Bacakan. Bacakan memakai suara id-ID di
   * perangkat; tombol hanya muncul bila suaranya ada.
   */
  let {
    judul,
    awal,
    akhir,
    bacakanDari = 'konten',
  }: {
    judul: string;
    awal?: Snippet | undefined;
    akhir?: Snippet | undefined;
    bacakanDari?: string;
  } = $props();

  const tts = ambilTts();

  function bacakan() {
    if (tts.membaca) return tts.berhenti();
    const el = document.getElementById(bacakanDari);
    tts.baca(el?.innerText ?? '');
  }
</script>

<header
  class="sticky top-16 z-10 flex min-h-14 flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur sm:px-7 lg:top-0 lg:min-h-[67.5px] lg:bg-surface/95 lg:py-2"
>
  {#if awal}{@render awal()}{/if}
  <h1
    class="min-w-0 flex-1 truncate text-lg font-semibold tracking-[-0.3px] text-ink sm:text-xl sm:leading-[30px]"
  >
    {judul}
  </h1>
  {#if akhir}{@render akhir()}{/if}
  {#if tts.tersedia}
    <button
      type="button"
      onclick={bacakan}
      aria-pressed={tts.membaca}
      class="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-2 bg-surface px-4 text-[15px] leading-[23px] text-ink transition-all duration-150 ease-out hover:bg-card active:scale-95"
    >
      <Icon name="bacakan" class="size-4.5" />
      {tts.membaca ? 'Berhenti' : 'Bacakan'}
    </button>
  {/if}
</header>
