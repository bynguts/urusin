<script lang="ts">
  import { resolve } from '$app/paths';
  import mark from '#lib/assets/img/pen-landing/urusin-mark-52.webp';

  /**
   * Header situs publik dari frame pen Rafi (n2rpg / F6RSq): logo, tautan bagian landing, Privasi, Masuk, Mulai
   * gratis. Gaya di landing-pen.css (kelas lpN). Di landing tautan bagian berupa jangkar; di halaman lain
   * menuju jangkar landing. `aktif` menandai halaman Privasi (pil frame F6RSq).
   */
  let { aktif }: { aktif?: 'privasi' } = $props();
  const diLanding = $derived(aktif === undefined);
  const ke = (jangkar: string) => (diLanding ? `#${jangkar}` : `${resolve('/')}#${jangkar}`);
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
  <!-- eslint-disable svelte/no-navigation-without-resolve -- `ke()` sudah memakai resolve('/') -->
  <nav class="n-nav-links lp7" aria-label="Navigasi utama">
    <a class="lp8" href={ke('cara-kerja')}>
      <span class="lp9"> Cara kerja </span>
    </a>
    <a class="lp8" href={ke('urusan')}>
      <span class="lp9"> Urusan </span>
    </a>
    <a
      class="lp8 {aktif === 'privasi' ? 'lp-aktif' : ''}"
      href={resolve('/privasi')}
      aria-current={aktif === 'privasi' ? 'page' : undefined}
    >
      <span class="lp9"> Privasi </span>
    </a>
    <a class="lp8" href={ke('tanya-jawab')}>
      <span class="lp9"> Tanya jawab </span>
    </a>
  </nav>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
  <div class="lp10">
    <a class="lp8" href={resolve('/masuk')}>
      <span class="lp9"> Masuk </span>
    </a>
    <a class="lp11" href="{resolve('/beranda')}?baru">
      <span class="lp12"> Mulai gratis </span>
    </a>
  </div>
</header>
