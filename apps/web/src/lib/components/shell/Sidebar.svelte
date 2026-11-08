<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '../Icon.svelte';
  import Lockup from './Lockup.svelte';
  import { NAV, menuAktif } from './navigasi.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';

  /** App/Sidebar (XNGdB): 248 px, menu utama, urusan aktif, dan kartu akun di bawah. */
  const lokal = ambilLokal();
  const aktif = $derived(lokal.data.urusan.slice(0, 4));
  /** Sesi juri (`jenis: 'demo'`) tidak punya email (docs/ui/auth.md). */
  const akun = $derived(page.data.akun as { email: string | null } | null | undefined);
  const label = $derived(akun ? (akun.email ?? 'Salinan demo juri') : '');
  const inisial = $derived(label.slice(0, 2).toUpperCase());
</script>

<aside
  class="pola-titik sticky top-0 hidden h-dvh w-62 shrink-0 flex-col gap-6 overflow-y-auto px-5 pt-5 pb-5 lg:flex"
  aria-label="Menu samping"
>
  <a href={resolve('/beranda')} class="flex h-10 items-center self-start rounded-lg px-1">
    <Lockup class="h-9 w-auto" />
  </a>

  <a
    href={resolve('/beranda')}
    class="flex min-h-12 items-center justify-center gap-2 rounded-full bg-primer px-5 text-[0.9375rem] font-medium text-primer-ink hover:opacity-90"
  >
    <Icon name="tambah" class="size-4" />
    Urusan baru
  </a>

  <nav aria-label="Navigasi utama">
    <ul class="flex flex-col gap-1">
      {#each NAV as item (item.href)}
        {@const kini = menuAktif(item.href, page.url.pathname)}
        <li>
          <a
            href={resolve(item.href)}
            aria-current={kini ? 'page' : undefined}
            class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base text-body transition-colors duration-300 hover:bg-bg aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-lembut"
          >
            <Icon name={item.ikon} class="size-5" />
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  {#if aktif.length}
    <section aria-labelledby="judul-urusan-aktif" class="flex flex-col gap-1">
      <h2 id="judul-urusan-aktif" class="px-3 text-sm font-semibold tracking-normal text-ink">
        Urusan aktif
      </h2>
      <ul class="flex flex-col gap-0.5">
        {#each aktif as u (u.id)}
          {@const kini = page.url.pathname === `/urusan/${u.id}`}
          <li>
            <a
              href={resolve('/urusan/[id]', { id: u.id })}
              aria-current={kini ? 'page' : undefined}
              class="flex min-h-11 items-center truncate rounded-xl px-3 text-[0.9375rem] text-body hover:bg-bg aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink"
              >{u.judul}</a
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="mt-auto">
    {#if akun}
      <a
        href={resolve('/pengaturan')}
        class="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 shadow-lembut hover:bg-card"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-full bg-mawar text-sm font-semibold text-mawar-ink"
          aria-hidden="true">{inisial}</span
        >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[0.9375rem] font-semibold text-ink">{label}</span>
          <span class="block text-[0.8125rem] text-muted">Akun Urusin</span>
        </span>
        <Icon name="atas-bawah" class="size-4 text-muted" />
      </a>
    {:else}
      <a
        href={resolve('/masuk')}
        class="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 shadow-lembut hover:bg-card"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-full bg-bg-2 text-ink"
          aria-hidden="true"
        >
          <Icon name="orang" class="size-4.5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[0.9375rem] font-semibold text-ink">Masuk</span>
          <span class="block text-[0.8125rem] text-muted">Simpan urusan di semua perangkat</span>
        </span>
        <Icon name="kanan" class="size-4 text-muted" />
      </a>
    {/if}
  </div>
</aside>
