<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Status di panel: titik + teks (DESIGN.md: "Status di panel memakai titik + teks, bukan pill"). */
  let {
    nada = 'netral',
    tebal = false,
    children,
  }: {
    nada?: 'anda' | 'instansi' | 'ai' | 'selesai' | 'netral';
    tebal?: boolean;
    children: Snippet;
  } = $props();

  const WARNA = {
    anda: 'bg-kuning-ink',
    instansi: 'bg-muted',
    ai: 'bg-nila-ink',
    selesai: 'bg-hijau-ink',
    netral: 'bg-muted',
  } as const;
  const TINTA = {
    anda: 'text-kuning-ink',
    instansi: 'text-muted',
    ai: 'text-nila-ink',
    selesai: 'text-hijau-ink',
    netral: 'text-muted',
  } as const;
</script>

<span class="inline-flex items-center gap-[7px] text-sm {TINTA[nada]} {tebal ? 'font-semibold' : ''}">
  <span class="size-2 shrink-0 rounded-full {WARNA[nada]}" aria-hidden="true"></span>
  {@render children()}
</span>
