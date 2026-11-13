<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import mark from '#lib/assets/img/app/urusin-mark-48.webp';
  import Icon from '../Icon.svelte';
  import { NAV, menuAktif } from './navigasi.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import { tandaiKeLanding } from '#lib/ke-landing.js';
  import GantiNamaUrusan from '../urusan/GantiNamaUrusan.svelte';
  import MenuUrusan from '../urusan/MenuUrusan.svelte';

  /**
   * Menu samping App 01–14 (Rafi): 248 px, logo + Urusan baru + lima menu + Urusan aktif + kartu akun.
   * Tombol panel menciutkan menu jadi rel ikon; urusan yang sedang dibuka disorot di "Urusan aktif".
   */
  const lokal = ambilLokal();
  const aktif = $derived(lokal.data.urusan.slice(0, 5));
  /** Sesi juri (`jenis: 'demo'`) tidak punya email (docs/ui/auth.md). */
  const akun = $derived(page.data.akun as { email: string | null; nama?: string | null } | null | undefined);
  const namaAkun = $derived(akun ? (akun.nama ?? akun.email?.split('@')[0] ?? 'Salinan demo juri') : '');
  const inisial = $derived(
    namaAkun
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join(''),
  );
  const idKini = $derived(page.url.pathname.match(/^\/(?:urusan|jejak)\/(u_[0-9a-f]{32})/)?.[1]);
  let ciut = $state(false);

  const menu: Record<string, MenuUrusan | undefined> = {};
  let gantiNama = $state<GantiNamaUrusan>();
</script>

<aside
  class="hidden h-full shrink-0 flex-col overflow-y-auto pt-2.5 pb-2 transition-[width] duration-200 ease-out lg:flex {ciut
    ? 'w-[68px] items-center gap-3 px-3'
    : 'w-[248px] gap-5 px-2'}"
  aria-label="Menu samping"
>
  <!-- Mode ciut: satu kolom tengah, semua tombol bujur sangkar 44 px agar sejajar (keputusan pemilik 2026-11-14). -->
  <div class="flex items-center justify-between {ciut ? 'flex-col gap-1.5' : 'px-1.5 py-1'}">
    <a
      href={resolve('/')}
      data-sveltekit-reload
      onclick={tandaiKeLanding}
      class="flex items-center gap-2 {ciut ? 'size-11 justify-center' : ''}"
      aria-label="Urusin, ke halaman depan"
    >
      <img src={mark} alt="" width="24" height="24" class="size-6" />
      {#if !ciut}<span class="font-lora text-[22px] leading-6 font-medium tracking-[-0.6px] text-ink"
          >Urusin</span
        >{/if}
    </a>
    <div class="flex items-center gap-1 {ciut ? 'flex-col' : ''}">
      <button
        type="button"
        onclick={() => (ciut = !ciut)}
        aria-expanded={!ciut}
        aria-label={ciut ? 'Buka menu samping' : 'Ciutkan menu samping'}
        title={ciut ? 'Buka menu samping' : 'Ciutkan menu samping'}
        class="grid place-items-center rounded-xl text-ink hover:bg-surface/70 {ciut ? 'size-11' : 'size-9'}"
      >
        <Icon name="panel" class="size-[18px]" />
      </button>
    </div>
  </div>

  <a
    href="{resolve('/beranda')}?baru"
    aria-label={ciut ? 'Urusan baru' : undefined}
    title={ciut ? 'Urusan baru' : undefined}
    class="flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primer text-sm leading-[21px] font-medium text-primer-ink {ciut
      ? 'size-11'
      : 'min-h-[41px] px-6 py-2.5'}"
  >
    <Icon name="tambah" class="size-4" />{#if !ciut}Urusan baru{/if}
  </a>

  <nav aria-label="Navigasi utama" class={ciut ? 'border-t border-line pt-3' : ''}>
    <ul class="flex flex-col {ciut ? 'items-center gap-1.5' : 'gap-1'}">
      {#each NAV as item (item.href)}
        {@const kini = menuAktif(item.href, page.url.pathname)}
        <li>
          <a
            href={resolve(item.href)}
            aria-current={kini ? 'page' : undefined}
            aria-label={ciut ? item.label : undefined}
            title={ciut ? item.label : undefined}
            class="flex items-center gap-3 rounded-xl {ciut
              ? 'size-11 justify-center'
              : 'h-12 px-3'} text-base leading-[22px] text-card-ink hover:bg-surface/60 aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]"
          >
            <Icon name={item.ikon} class="size-5 shrink-0 text-ink" />{#if !ciut}{item.label}{/if}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  {#if !ciut && aktif.length}
    <section aria-labelledby="judul-urusan-aktif" class="flex flex-col gap-0.5 pt-2">
      <h2
        id="judul-urusan-aktif"
        class="px-3 pb-1.5 text-[13px] font-semibold tracking-[0.2px] text-card-ink"
      >
        Urusan aktif
      </h2>
      <ul class="flex flex-col gap-0.5">
        {#each aktif as u (u.id)}
          <li class="group relative flex items-center" data-urusan-aktif={u.id}>
            <a
              href={resolve('/urusan/[id]', { id: u.id })}
              aria-current={u.id === idKini ? 'page' : undefined}
              title={u.judul}
              oncontextmenu={(e) => {
                e.preventDefault();
                void menu[u.id]?.buka();
              }}
              class="flex h-10 min-w-0 flex-1 items-center rounded-[10px] pr-10 pl-3 text-[15px] text-card-ink hover:bg-surface/60 aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink"
            >
              <span class="truncate">{u.judul}</span>
            </a>
            <MenuUrusan
              bind:this={menu[u.id]}
              label={u.judul}
              onganti={() => gantiNama?.buka(u.id, u.judul)}
              class="absolute right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            />
          </li>
        {/each}
      </ul>
    </section>
    <GantiNamaUrusan bind:this={gantiNama} />
  {/if}

  <div class="flex-1"></div>

  <a
    href={resolve(akun ? '/pengaturan' : '/masuk')}
    aria-label={ciut ? (akun ? namaAkun : 'Masuk') : undefined}
    title={ciut ? (akun ? namaAkun : 'Masuk') : undefined}
    class="flex shrink-0 items-center {ciut
      ? 'size-11 justify-center rounded-full hover:ring-2 hover:ring-line'
      : 'h-14 gap-2.5 rounded-[14px] border border-line bg-surface px-2.5 hover:bg-card'}"
  >
    <span
      class="grid shrink-0 place-items-center rounded-full bg-mawar text-sm leading-none font-semibold text-mawar-ink {ciut
        ? 'size-10'
        : 'size-9'}"
      aria-hidden="true"
    >
      {#if akun}{inisial || '?'}{:else}<Icon name="orang" class="size-4" />{/if}
    </span>
    {#if !ciut}
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class="truncate text-[15px] leading-5 font-semibold text-ink">{akun ? namaAkun : 'Masuk'}</span>
        <span class="truncate text-[13px] leading-[18px] text-muted"
          >{akun ? 'Akun Urusin' : 'Simpan di semua perangkat'}</span
        >
      </span>
      <Icon name="atas-bawah" class="size-[18px] shrink-0 text-ink" />
    {/if}
  </a>
</aside>
