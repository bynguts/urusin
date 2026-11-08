<script lang="ts">
  import './layout.css';
  import favicon from '#lib/assets/favicon.svg';
  import Icon from '#lib/components/Icon.svelte';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { LayoutProps } from './$types';

  let { children, data }: LayoutProps = $props();

  const NAV = [
    { href: '/', label: 'Beranda', icon: 'beranda' },
    { href: '/#urusanku', label: 'Urusanku', icon: 'urusan' },
    { href: '/#bantuan', label: 'Bantuan', icon: 'bantuan' },
  ] as const;

  const isCurrent = (href: string) => href === '/' && page.url.pathname === resolve('/');
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Urusin</title>
</svelte:head>

<a
  href="#konten"
  class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-white focus:px-3 focus:py-2"
  >Lewati ke konten</a
>

<div class="min-h-dvh bg-slate-50 text-slate-900 lg:grid lg:grid-cols-[16rem_1fr]">
  <!-- Panel kiri (layar >= 1024px) -->
  <aside class="hidden border-r border-slate-200 bg-white lg:flex lg:min-h-dvh lg:flex-col lg:p-6">
    <a href={resolve('/')} class="text-2xl font-bold tracking-tight text-brand-700">Urusin</a>
    <p class="mt-1 text-sm text-slate-600">Teman mengurus layanan publik</p>
    <nav aria-label="Navigasi utama" class="mt-8">
      <ul class="space-y-1">
        {#each NAV as item (item.href)}
          <li>
            <a
              href={resolve(item.href)}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
              class="flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-slate-700 hover:bg-brand-50 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-800"
            >
              <Icon name={item.icon} class="size-5" />
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>

  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 lg:hidden">
      <a href={resolve('/')} class="text-xl font-bold tracking-tight text-brand-700">Urusin</a>
    </header>

    <main id="konten" class="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-8 lg:px-10 lg:pt-10">
      {@render children()}
    </main>

    <footer class="mx-auto w-full max-w-3xl px-4 pb-24 text-xs text-slate-500 lg:px-10 lg:pb-6">
      <p>
        Urusin bukan situs pemerintah. Pengiriman akhir selalu Anda lakukan sendiri di situs resmi.
        <span class="whitespace-nowrap">v{data.version}</span>
      </p>
    </footer>
  </div>
</div>

<!-- Navigasi bawah (layar < 1024px) -->
<nav
  aria-label="Navigasi bawah"
  class="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
>
  <ul class="grid grid-cols-3">
    {#each NAV as item (item.href)}
      <li>
        <a
          href={resolve(item.href)}
          aria-current={isCurrent(item.href) ? 'page' : undefined}
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-slate-600 aria-[current=page]:text-brand-700"
        >
          <Icon name={item.icon} class="size-6" />
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
