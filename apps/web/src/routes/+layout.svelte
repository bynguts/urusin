<script lang="ts">
  import './layout.css';
  import favicon from '#lib/assets/img/favicon.png';
  import NavBawah from '#lib/components/shell/NavBawah.svelte';
  import Sidebar from '#lib/components/shell/Sidebar.svelte';
  import { NAV, rutAuth } from '#lib/components/shell/navigasi.js';
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
  const terakhir = $derived(lokal.data.urusan[0]?.id);
  let menuBuka = $state(false);

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

    <div class="flex min-w-0 flex-1 flex-col bg-bg">
      <!-- Bilah atas HP (frame IzXAR) -->
      <div
        class="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-line bg-bg/95 pr-6 pl-6 backdrop-blur lg:hidden"
      >
        <a href={resolve('/beranda')} class="wordmark flex h-12 items-center text-[1.75rem]">urusin.</a>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="grid size-11 place-items-center rounded-full bg-bg-2 text-ink"
            aria-label="Bantuan suara"
            aria-pressed={prefs.nilai.bacakanOtomatis}
            onclick={() => prefs.atur('bacakanOtomatis', !prefs.nilai.bacakanOtomatis)}
          >
            <Icon name="bacakan" class="size-5" />
          </button>
          <button
            type="button"
            class="grid size-11 place-items-center rounded-full bg-bg-2 text-ink"
            aria-label={menuBuka ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={menuBuka}
            aria-controls="menu-app-hp"
            onclick={() => (menuBuka = !menuBuka)}
          >
            <Icon name={menuBuka ? 'tutup' : 'menu'} class="size-5" />
          </button>
        </div>
        {#if menuBuka}
          <nav
            id="menu-app-hp"
            aria-label="Menu"
            class="absolute inset-x-4 top-[4.75rem] rounded-[1.25rem] border border-line bg-surface p-3 shadow-lembut"
          >
            {#each NAV as item (item.href)}
              <a
                href={item.href === '/jejak'
                  ? terakhir
                    ? resolve('/jejak/[id]', { id: terakhir })
                    : resolve('/urusanku')
                  : resolve(item.href)}
                onclick={() => (menuBuka = false)}
                class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base hover:bg-bg-2"
              >
                <Icon name={item.ikon} class="size-[1.125rem]" />{item.label}
              </a>
            {/each}
            <a
              href={resolve(akun ? '/pengaturan' : '/masuk')}
              onclick={() => (menuBuka = false)}
              class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold hover:bg-bg-2"
            >
              <Icon name="orang" class="size-[1.125rem]" />{akun ? 'Akun dan pengaturan' : 'Masuk'}
            </a>
          </nav>
        {/if}
      </div>

      <main id="konten" tabindex="-1" class="flex min-h-0 flex-1 flex-col bg-bg pb-24 outline-none lg:pb-0">
        {@render children()}
      </main>
    </div>
  </div>
  <NavBawah />
{/if}
