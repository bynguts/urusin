<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import mark from '#lib/assets/img/pen-landing/urusin-mark-52.webp';

  /**
   * Header situs publik dari frame pen Rafi (n2rpg / F6RSq): logo, tautan bagian landing, Privasi, Masuk, Mulai
   * gratis. Gaya di landing-pen.css (kelas lpN). Tautan menuju halaman Web masing-masing; `aktif` menandai
   * halaman yang sedang dibuka (pil frame F6RSq).
   */
  type Halaman = 'cara-kerja' | 'urusan' | 'privasi' | 'tanya-jawab';
  let { aktif }: { aktif?: Halaman } = $props();
  const diLanding = $derived(aktif === undefined);
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
  const TAUTAN: { id: Halaman; label: string; href: string }[] = [
    { id: 'cara-kerja', label: 'Cara kerja', href: resolve('/cara-kerja') },
    { id: 'urusan', label: 'Urusan', href: resolve('/urusan') },
    { id: 'privasi', label: 'Privasi', href: resolve('/privasi') },
    { id: 'tanya-jawab', label: 'Tanya jawab', href: resolve('/tanya-jawab') },
  ];
</script>

<header class="n-header lp3">
  {#if diLanding}
    <a class="lp4" href="#atas" aria-label="Urusin, ke atas">
      <img class="lp5" src={mark} alt="" width="26" height="26" decoding="async" />
      <span class="lp6"> Urusin </span>
    </a>
  {:else}
    <a class="lp4" href={resolve('/')} aria-label="Urusin, ke beranda">
      <img class="lp5" src={mark} alt="" width="26" height="26" decoding="async" />
      <span class="lp6"> Urusin </span>
    </a>
  {/if}
  <nav class="n-nav-links lp7" aria-label="Navigasi utama">
    <!-- eslint-disable svelte/no-navigation-without-resolve -- href TAUTAN sudah memakai resolve() -->
    {#each TAUTAN as t (t.id)}
      <a
        class="lp8 {aktif === t.id ? 'lp-aktif' : ''}"
        href={t.href}
        aria-current={aktif === t.id ? 'page' : undefined}
      >
        <span class="lp9"> {t.label} </span>
      </a>
    {/each}
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  </nav>
  <div class="lp10">
    {#if page.data.akun}
      <a class="lp8" href={resolve('/beranda')}>
        <span class="lp9"> Beranda </span>
      </a>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="lp11" href={resolve('/beranda')}>
        <span class="lp12"> Buka beranda </span>
      </a>
    {:else}
      <a class="lp8" href={resolve('/masuk')}>
        <span class="lp9"> Masuk </span>
      </a>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="lp11" href={targetMulai}>
        <span class="lp12"> Mulai gratis </span>
      </a>
    {/if}
  </div>
</header>
