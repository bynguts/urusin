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

<!-- Ruang 64 px di aliran halaman: header sendiri menempel di atas layar saat digulir. -->
<div class="ruang-header" aria-hidden="true"></div>
<header class="n-header lp3 header-tempel">
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

<style>
  /*
   * Header menempel di atas layar saat digulir (keputusan pemilik 2026-11-14). fixed, bukan sticky: di landing
   * header berada di dalam bagian hero, jadi sticky akan berhenti di akhir hero. .ruang-header menjaga tata
   * letak tetap sama. Di puncak halaman header transparan (pola hero tetap terlihat); begitu digulir, latar
   * krem buram + garis tipis muncul (scroll-driven; peramban tanpa dukungan langsung memakai latar penuh).
   */
  /* lompatan ke #bagian tidak tertutup header yang menempel */
  :global(html) {
    scroll-padding-top: 72px;
  }
  .ruang-header {
    height: 64px;
    width: 100%;
    flex-shrink: 0;
  }
  .header-tempel {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    max-width: none;
    background-color: rgb(255 252 250 / 0.86);
    backdrop-filter: saturate(1.4) blur(14px);
    -webkit-backdrop-filter: saturate(1.4) blur(14px);
    box-shadow: 0 1px 0 var(--sb-stroke, #efe6dc);
  }
  @supports (animation-timeline: scroll()) {
    .header-tempel {
      background-color: rgb(255 252 250 / 0);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      box-shadow: 0 1px 0 rgb(239 230 220 / 0);
      animation: header-padat linear both;
      animation-timeline: scroll(root);
      animation-range: 0 72px;
    }
  }
  @keyframes header-padat {
    to {
      background-color: rgb(255 252 250 / 0.86);
      backdrop-filter: saturate(1.4) blur(14px);
      box-shadow: 0 1px 0 var(--sb-stroke, #efe6dc);
    }
  }
</style>
