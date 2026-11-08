<script lang="ts">
  import './layout.css';
  import favicon from '#lib/assets/img/favicon.png';
  import Lockup from '#lib/components/shell/Lockup.svelte';
  import NavBawah from '#lib/components/shell/NavBawah.svelte';
  import Sidebar from '#lib/components/shell/Sidebar.svelte';
  import { rutAuth } from '#lib/components/shell/navigasi.js';
  import Icon from '#lib/components/Icon.svelte';
  import { ambilLokal, ambilPrefs } from '#lib/stores/app.svelte.js';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const prefs = ambilPrefs();
  const lokal = ambilLokal();
  const polos = $derived(page.url.pathname === '/' || rutAuth(page.url.pathname));
  const akun = $derived(page.data.akun as { email: string } | null | undefined);

  // Preferensi tampilan diterapkan di <html>: ukuran huruf, tema, kontras, gerak.
  $effect(() => {
    const html = document.documentElement;
    html.style.setProperty('--skala-huruf', String(prefs.nilai.ukuranHuruf));
    html.dataset.theme = prefs.nilai.tema === 'gelap' ? 'dark' : 'light';
    html.dataset.kontras = lokal.data.kontrasTinggi ? 'tinggi' : 'normal';
    html.dataset.gerak = lokal.data.kurangiGerak ? 'kurang' : 'normal';
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} type="image/png" />
  <title>Urusin</title>
</svelte:head>

<a
  href="#konten"
  class="sr-only z-50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-full focus:bg-surface focus:px-4 focus:py-3 focus:font-medium focus:shadow-lembut"
  >Lewati ke konten</a
>

{#if polos}
  {@render children()}
{:else}
  <div class="flex min-h-dvh bg-bg-2">
    <Sidebar />

    <div class="flex min-w-0 flex-1 flex-col lg:py-3 lg:pr-3">
      <!-- Bilah atas HP -->
      <div
        class="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur lg:hidden"
      >
        <a href={resolve('/beranda')} class="flex h-12 items-center"><Lockup class="h-8 w-auto" /></a>
        {#if akun}
          <a
            href={resolve('/pengaturan')}
            class="grid size-12 place-items-center rounded-full text-ink hover:bg-bg-2"
            aria-label="Akun dan pengaturan"
          >
            <Icon name="orang" class="size-5" />
          </a>
        {:else}
          <a
            href={resolve('/masuk')}
            class="inline-flex min-h-12 items-center rounded-full px-4 text-[0.9375rem] font-medium text-ink hover:bg-bg-2"
            >Masuk</a
          >
        {/if}
      </div>

      <main
        id="konten"
        tabindex="-1"
        class="flex min-h-0 flex-1 flex-col bg-bg pb-24 outline-none lg:rounded-2xl lg:bg-surface lg:pb-0 lg:shadow-lembut"
      >
        {@render children()}
      </main>
    </div>
  </div>
  <NavBawah />
{/if}
