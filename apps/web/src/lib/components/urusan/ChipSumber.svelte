<script lang="ts">
  import Icon from '../Icon.svelte';
  import { domain } from '#lib/urusan-status.js';

  /**
   * Chip sumber [n] domain · tanggal periksa. Tautan membuka situs resmi (dengan Text Fragment bila ada).
   * Sumber yang belum/lebih dari 30 hari tidak diperiksa ditandai "cek ulang" (bukan warna saja).
   */
  let {
    nomor,
    url,
    diperiksa,
    perluDicekUlang = false,
    aktif = false,
  }: {
    nomor: number;
    url: string;
    diperiksa?: string | undefined;
    perluDicekUlang?: boolean;
    aktif?: boolean;
  } = $props();
</script>

<a
  href={url}
  target="_blank"
  rel="external noopener noreferrer"
  class="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-surface px-3 text-[0.8125rem] text-ink hover:bg-card {aktif
    ? 'border-ink'
    : 'border-line-2'}"
>
  <span class="grid size-5 shrink-0 place-items-center rounded-full bg-bg-2 text-[0.6875rem] font-semibold"
    >{nomor}</span
  >
  <span class="truncate font-medium">{domain(url)}</span>
  {#if perluDicekUlang}
    <span class="shrink-0 text-kuning-ink">· cek ulang</span>
  {:else if diperiksa}
    <span class="shrink-0 text-muted">· Diperiksa {diperiksa}</span>
  {/if}
  <Icon name="keluar" class="size-3.5 shrink-0 text-muted" />
  <span class="sr-only">(buka situs resmi di tab baru)</span>
</a>
