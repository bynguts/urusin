<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.peristiwa.judul} · Urusin</title>
</svelte:head>

<a href={resolve('/')} class="text-sm font-medium text-brand-700">&larr; Kembali</a>
<div class="mt-4 flex items-center gap-3">
  <span class="rounded-lg bg-brand-50 p-2 text-brand-700"><Icon name={data.peristiwa.icon} /></span>
  <h1 class="text-2xl font-bold">{data.peristiwa.judul}</h1>
</div>
<p class="mt-3 text-slate-600">{data.peristiwa.ringkas}</p>
<p class="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
  Panduan langkah demi langkah untuk peristiwa ini sedang disiapkan.
</p>
