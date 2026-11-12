<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tautanLuar } from '#lib/tautan.js';

  /**
   * Tautan di dalam konten (pesan, kartu, sumber, bantuan): biru bergaris bawah (token --color-tautan).
   * Tautan luar membuka tab baru tanpa referrer. `bukanResmi` = data menandai situs ini bukan situs resmi.
   */
  let {
    href,
    bukanResmi = false,
    rel = 'noopener noreferrer nofollow',
    class: kelas = '',
    children,
  }: {
    href: string;
    bukanResmi?: boolean | undefined;
    rel?: string;
    class?: string;
    children: Snippet;
  } = $props();

  const luar = $derived(tautanLuar(href));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- href dari data/teks yang sudah disaring (http/https) atau rute yang sudah lewat resolve() -->
<a {href} target={luar ? '_blank' : undefined} rel={luar ? rel : undefined} class="tautan {kelas}"
  >{@render children()}{#if luar}<span class="sr-only">&nbsp;(buka di tab baru)</span>{/if}</a
>{#if bukanResmi}<span
    class="ml-1 inline-block rounded-full bg-kuning px-1.5 align-[0.1em] text-xs leading-[18px] font-medium text-kuning-ink"
    >bukan situs resmi</span
  >{/if}
