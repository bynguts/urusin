<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import mark from '#lib/assets/img/app/urusin-mark-48.webp';
  import Icon from '../Icon.svelte';
  import { NAV, menuAktif } from './navigasi.js';
  import { ambilLokal, ambilPrefs } from '#lib/stores/app.svelte.js';

  /**
   * Menu samping App 01–14 (Rafi): 248 px, logo + Urusan baru + lima menu + Urusan aktif + kartu akun.
   * Tombol panel menciutkan menu jadi rel ikon; urusan yang sedang dibuka disorot di "Urusan aktif".
   */
  const lokal = ambilLokal();
  const prefs = ambilPrefs();
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
</script>

<aside
  class="hidden h-full shrink-0 flex-col overflow-y-auto px-2 pt-2.5 pb-2 transition-[width] duration-200 ease-out lg:flex {ciut
    ? 'w-16 gap-3.5'
    : 'w-[248px] gap-5'}"
  aria-label="Menu samping"
>
  <div class="flex items-center justify-between px-1.5 py-1 {ciut ? 'flex-col gap-2' : ''}">
    <a href={resolve('/beranda')} class="flex items-center gap-2 {ciut ? 'justify-center py-1' : ''}" aria-label="Urusin, ke Beranda">
      <img src={mark} alt="" width="24" height="24" class="size-6" />
      {#if !ciut}<span class="font-lora text-[22px] leading-6 font-medium tracking-[-0.6px] text-ink"
          >Urusin</span
        >{/if}
    </a>
    <div class="flex items-center gap-1 {ciut ? 'flex-col' : ''}">
      <button
        type="button"
        onclick={() => prefs.atur('tema', prefs.nilai.tema === 'gelap' ? 'terang' : 'gelap')}
        aria-label={prefs.nilai.tema === 'gelap' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
        title={prefs.nilai.tema === 'gelap' ? 'Tema terang' : 'Tema gelap'}
        class="grid size-9 place-items-center rounded-xl text-ink transition-colors hover:bg-surface/70"
      >
        <Icon name={prefs.nilai.tema === 'gelap' ? 'matahari' : 'bulan'} class="size-[18px]" />
      </button>
      <button
        type="button"
        onclick={() => (ciut = !ciut)}
        aria-expanded={!ciut}
        aria-label={ciut ? 'Buka menu samping' : 'Ciutkan menu samping'}
        class="grid size-9 place-items-center rounded-xl text-ink transition-colors hover:bg-surface/70"
      >
        <Icon name="panel" class="size-[18px]" />
      </button>
    </div>
  </div>

  <a
    href="{resolve('/beranda')}?baru"
    aria-label={ciut ? 'Urusan baru' : undefined}
    class="flex min-h-[41px] items-center justify-center gap-1.5 rounded-full bg-primer py-2.5 text-sm leading-[21px] font-medium text-primer-ink hover:opacity-90 {ciut
      ? 'px-0'
      : 'px-6'}"
  >
    <Icon name="tambah" class="size-4" />{#if !ciut}Urusan baru{/if}
  </a>

  <nav aria-label="Navigasi utama">
    <ul class="flex flex-col gap-1">
      {#each NAV as item (item.href)}
        {@const kini = menuAktif(item.href, page.url.pathname)}
        <li>
          <a
            href={resolve(item.href)}
            aria-current={kini ? 'page' : undefined}
            aria-label={ciut ? item.label : undefined}
            class="flex h-12 items-center gap-3 rounded-xl px-3 text-base leading-[22px] text-card-ink hover:bg-surface/60 aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]"
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
          <li>
            <a
              href={resolve('/urusan/[id]', { id: u.id })}
              aria-current={u.id === idKini ? 'page' : undefined}
              class="flex h-10 items-center rounded-[10px] px-3 text-[15px] text-card-ink hover:bg-surface/60 aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink"
            >
              <span class="truncate">{u.judul}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="flex-1"></div>

  <a
    href={resolve(akun ? '/pengaturan' : '/masuk')}
    aria-label={ciut ? (akun ? namaAkun : 'Masuk') : undefined}
    class="flex h-14 shrink-0 items-center rounded-[14px] border border-line bg-surface hover:bg-card {ciut
      ? 'justify-center p-0'
      : 'gap-2.5 px-2.5'}"
  >
    <span
      class="grid size-9 shrink-0 place-items-center rounded-full bg-mawar text-sm leading-none font-semibold text-mawar-ink"
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
