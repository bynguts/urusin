<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getExtensionRuntime,
    NONCE_STORAGE_KEY,
    pairAndPing,
    parseNonceFromHash,
  } from '#lib/extension-bridge.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let status = $state<'working' | 'ok' | 'error'>('working');
  let detail = $state('');

  onMount(async () => {
    const nonce = parseNonceFromHash(location.hash);
    // Hapus fragment segera: nonce tidak boleh tersisa di riwayat/URL.
    replaceState(resolve('/pair'), {});
    if (!nonce) {
      status = 'error';
      detail = 'Tautan pairing tidak valid. Mulai lagi dari popup ekstensi.';
      return;
    }
    const result = await pairAndPing(getExtensionRuntime(), data.extensionId, nonce);
    if (result.ok) {
      try {
        sessionStorage.setItem(NONCE_STORAGE_KEY, nonce);
      } catch {
        // sessionStorage bisa terblokir; pairing di sisi ekstensi tetap sah
      }
      status = 'ok';
      detail = result.origin;
    } else {
      status = 'error';
      detail = result.code;
    }
  });
</script>

<svelte:head>
  <title>Hubungkan ekstensi · Urusin</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1 class="text-2xl font-bold">Hubungkan ekstensi Urusin</h1>
<p class="mt-4" aria-live="polite" data-status={status}>
  {#if status === 'working'}
    Menghubungkan...
  {:else if status === 'ok'}
    Terhubung ke ekstensi ({detail}).
  {:else}
    Gagal menghubungkan: {detail}
  {/if}
</p>
