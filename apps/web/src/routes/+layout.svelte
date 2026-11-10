<script lang="ts">
  import './layout.css';
  import favicon from '#lib/assets/img/favicon.png';
  import mark from '#lib/assets/img/app/urusin-mark-48.webp';
  import NavBawah from '#lib/components/shell/NavBawah.svelte';
  import Sidebar from '#lib/components/shell/Sidebar.svelte';
  import { NAV, rutAuth, rutWeb } from '#lib/components/shell/navigasi.js';
  import Icon from '#lib/components/Icon.svelte';
  import { ambilLokal, ambilPrefs } from '#lib/stores/app.svelte.js';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { MediaQuery } from 'svelte/reactivity';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const prefs = ambilPrefs();
  const lokal = ambilLokal();
  // Menu samping hanya tampil mulai lg (64rem, `hidden lg:flex`). SSR tetap merendernya (desktop tanpa
  // kedip); di HP klien membuang markup tersembunyi itu alih-alih meng-hydrate-nya, dan memasangnya bila
  // layar melebar. Tampilan sama di semua ukuran.
  const layarLebar = new MediaQuery('min-width: 64rem', true);
  // Halaman Web publik berdesain landing dan rute auth tampil tanpa kerangka aplikasi.
  const polos = $derived(rutWeb(page.url.pathname) || rutAuth(page.url.pathname));
  const akun = $derived(page.data.akun as { email: string } | null | undefined);
  let menuBuka = $state(false);

  // Preferensi tampilan diterapkan di <html>: ukuran huruf, kontras, gerak. Aplikasi beroperasi dalam mode terang.
  $effect(() => {
    const html = document.documentElement;
    html.style.setProperty('--skala-huruf', String(prefs.nilai.ukuranHuruf));
    html.dataset.theme = 'light';
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
  <!-- App 01–14: bingkai krem bertitik, menu samping 248 px, panel utama putih membulat (desktop). -->
  <div class="bingkai-app flex min-h-dvh bg-bg-2 lg:h-dvh lg:overflow-hidden lg:gap-3 lg:p-3">
    {#if layarLebar.current}<Sidebar />{/if}

    <div
      class="relative flex min-w-0 flex-1 flex-col bg-bg lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:bg-surface lg:shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] lg:outline lg:outline-1 lg:-outline-offset-1 lg:outline-line"
      id="panel-utama"
    >
      <!-- Bilah atas HP (frame IzXAR) -->
      <div
        class="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-bg/95 pr-5 pl-5 backdrop-blur lg:hidden"
      >
        <a href={resolve('/beranda')} class="flex h-11 items-center gap-2" aria-label="Urusin, ke Beranda">
          <img src={mark} alt="" width="24" height="24" class="size-6" />
          <span class="font-lora text-[22px] leading-6 font-medium tracking-[-0.6px] text-ink">Urusin</span>
        </a>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="grid size-11 place-items-center rounded-full bg-bg-2 text-ink transition-colors hover:bg-card"
            aria-label="Bantuan suara"
            aria-pressed={prefs.nilai.bacakanOtomatis}
            onclick={() => prefs.atur('bacakanOtomatis', !prefs.nilai.bacakanOtomatis)}
          >
            <Icon name="bacakan" class="size-5" />
          </button>
          <button
            type="button"
            class="grid size-11 place-items-center rounded-full bg-bg-2 text-ink transition-colors hover:bg-card"
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
                href={resolve(item.href)}
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

      <main
        id="konten"
        tabindex="-1"
        class="flex flex-1 flex-col bg-bg pb-24 outline-none lg:bg-transparent lg:pb-0"
      >
        {#key page.url.pathname}
          <div class="animasi-dasbor-masuk flex flex-1 flex-col">
            {@render children()}
          </div>
        {/key}
      </main>
    </div>
  </div>
  <NavBawah />
{/if}
