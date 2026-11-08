<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '../Icon.svelte';
  import { NAV, menuAktif } from './navigasi.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';

  /** Menu samping (frame uCOBS/aK2Ex): 200 px, latar sekunder, akun di bawah. */
  const lokal = ambilLokal();
  const terakhir = $derived(lokal.data.urusan[0]?.id);
  const akun = $derived(page.data.akun as { email: string; nama?: string | null } | null | undefined);
  const namaAkun = $derived(akun ? (akun.nama ?? akun.email.split('@')[0] ?? akun.email) : '');
</script>

<aside
  class="sticky top-0 hidden h-dvh w-50 shrink-0 flex-col overflow-y-auto bg-bg-2 px-4 pt-7 pb-5 lg:flex"
  aria-label="Menu samping"
>
  <a href={resolve('/beranda')} class="wordmark self-start text-[1.625rem]">urusin.</a>

  <a
    href="{resolve('/beranda')}?baru"
    class="mt-[1.4375rem] flex h-[3.25rem] items-center justify-center gap-3 rounded-full bg-primer text-base font-semibold text-primer-ink hover:opacity-90"
  >
    <Icon name="panah" class="size-[1.125rem]" />
    Urusan baru
  </a>

  <nav aria-label="Navigasi utama" class="mt-6">
    <ul class="flex flex-col gap-2">
      {#each NAV as item (item.href)}
        {@const kini = menuAktif(item.href, page.url.pathname)}
        <li>
          <a
            href={item.href === '/jejak'
              ? terakhir
                ? resolve('/jejak/[id]', { id: terakhir })
                : resolve('/urusanku')
              : resolve(item.href)}
            aria-current={kini ? 'page' : undefined}
            class="flex min-h-[3.25rem] items-center gap-4 rounded-xl px-3 py-1.5 text-[0.9375rem] leading-[1.6] text-muted transition-colors hover:text-ink aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            <Icon name={item.ikon} class="size-[1.125rem] shrink-0" />
            <span class="max-w-[6.25rem]">{item.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="mt-auto">
    <a
      href={resolve('/bantuan')}
      class="flex min-h-12 items-center gap-2.5 text-base font-semibold text-ink hover:opacity-70"
    >
      <Icon name="obrolan" class="size-[1.125rem]" /> Butuh bantuan?
    </a>
    <div class="mt-3 border-t border-line pt-4">
      <a
        href={resolve(akun ? '/pengaturan' : '/masuk')}
        class="flex min-h-12 items-center gap-3 rounded-xl hover:opacity-80"
      >
        <span
          class="grid size-10 shrink-0 place-items-center rounded-full bg-line text-[0.9375rem] font-semibold text-ink"
          aria-hidden="true"
        >
          {#if akun}{namaAkun.slice(0, 1).toUpperCase()}{:else}<Icon name="orang" class="size-4.5" />{/if}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-base font-semibold text-ink">{akun ? namaAkun : 'Masuk'}</span>
          <span class="block truncate text-[0.875rem] text-muted"
            >{akun ? 'Akun Urusin' : 'Simpan di semua perangkat'}</span
          >
        </span>
      </a>
    </div>
  </div>
</aside>
