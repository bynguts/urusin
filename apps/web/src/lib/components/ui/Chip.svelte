<script lang="ts" module>
  /**
   * Chip status/pelaku (Label/Pelaku, Chip/Mode, Status/*). Selalu ikon + teks, bukan warna saja.
   * Nada: anda (amber), ai (indigo), instansi (biru), urusin (netral), hijau, kuning, galat, mawar, ungu, daun.
   */
  export type Nada =
    | 'anda'
    | 'ai'
    | 'instansi'
    | 'urusin'
    | 'hijau'
    | 'kuning'
    | 'galat'
    | 'mawar'
    | 'ungu'
    | 'daun'
    | 'biru'
    | 'netral';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../Icon.svelte';
  import type { NamaIkon } from '../ikon.js';

  let {
    nada = 'netral',
    ikon,
    besar = false,
    wrap = false,
    class: kelas = '',
    children,
  }: {
    nada?: Nada;
    ikon?: NamaIkon | undefined;
    besar?: boolean;
    wrap?: boolean;
    class?: string;
    children: Snippet;
  } = $props();

  const NADA: Record<Nada, string> = {
    anda: 'bg-kuning text-kuning-ink',
    kuning: 'bg-kuning text-kuning-ink',
    ai: 'bg-nila text-nila-ink',
    instansi: 'bg-biru text-biru-ink',
    biru: 'bg-biru text-biru-ink',
    urusin: 'bg-line-3 text-muted',
    netral: 'bg-line-3 text-muted',
    hijau: 'bg-hijau text-hijau-ink',
    daun: 'bg-daun text-daun-ink',
    galat: 'bg-mawar text-galat',
    mawar: 'bg-mawar text-mawar-ink',
    ungu: 'bg-ungu text-ungu-ink',
  };
</script>

<span
  class="inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium {wrap
    ? 'max-w-full whitespace-normal'
    : 'whitespace-nowrap'} {besar ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-[0.8125rem]'} {NADA[
    nada
  ]} {kelas}"
>
  {#if ikon}<Icon name={ikon} class="size-[1.05em] shrink-0" />{/if}
  {@render children()}
</span>
