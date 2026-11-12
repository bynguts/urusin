<script lang="ts">
  import { pecahTautan } from '#lib/tautan.js';
  import Tautan from './Tautan.svelte';

  /** Teks biasa dengan URL http/https menjadi tautan yang bisa diklik (tanpa {@html}). */
  let { teks }: { teks: string } = $props();

  const segmen = $derived(pecahTautan(teks));
</script>

{#each segmen as s, i (i)}{#if s.jenis === 'tautan'}<Tautan href={s.href}>{s.teks}</Tautan
    >{:else}{s.teks}{/if}{/each}
