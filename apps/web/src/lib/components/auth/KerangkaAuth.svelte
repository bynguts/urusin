<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import amber1 from '#lib/assets/img/app/akun-amber-jempol-206.webp';
  import amber2 from '#lib/assets/img/app/akun-amber-jempol-412.webp';
  import ungu1 from '#lib/assets/img/app/akun-purple-laptop-192.webp';
  import ungu2 from '#lib/assets/img/app/akun-purple-laptop-384.webp';
  import mawar1 from '#lib/assets/img/app/akun-rose-melambai-220.webp';
  import mawar2 from '#lib/assets/img/app/akun-rose-melambai-440.webp';
  import panel from '#lib/assets/img/app/panel-akun-b979.webp';
  import Lockup from '../shell/Lockup.svelte';

  /**
   * Layar akun App 15–20: panel brand (judul besar + tiga karakter) di kiri, formulir di kartu kanan.
   * Desktop mengikuti frame pen: panel 640 px berlatar gradasi titik dari ekspor, lockup 183×61 di (40, 36),
   * judul 40/44 di y 150, tiga karakter berdiri 24 px dari bawah. `judul` boleh berisi "\n" untuk jeda baris
   * seperti frame. Di HP panel brand diringkas menjadi lockup + judul di atas formulir.
   */
  let { judul, sub, children }: { judul: string; sub: string; children: Snippet } = $props();
</script>

<div class="flex min-h-dvh flex-col gap-3 bg-bg-2 p-0 lg:flex-row lg:p-3">
  <aside
    class="panel-akun pola-titik relative flex flex-col overflow-hidden bg-gradient-to-b from-[#f9e9e0] via-bg to-bg-2 px-5 pt-5 pb-6 lg:w-[min(640px,46%)] lg:shrink-0 lg:rounded-[1.25rem] lg:border lg:border-line lg:px-10 lg:pt-9 lg:pb-0"
    style:--panel-akun="url({panel})"
  >
    <a href={resolve('/')} class="flex h-12 w-fit items-center lg:h-auto"
      ><Lockup class="h-9 w-auto lg:h-[61px]" /></a
    >
    <p
      class="mt-5 max-w-[34rem] text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.03em] whitespace-pre-line text-ink lg:mt-[53px] lg:text-[2.5rem] lg:leading-[44px] lg:font-medium lg:tracking-[-1.3px]"
    >
      {judul}
    </p>
    <p class="mt-2 max-w-[34rem] text-[0.9375rem] text-body lg:mt-3.5 lg:text-[1.0625rem] lg:leading-[25px]">
      {sub}
    </p>
    <div class="relative mt-auto hidden h-[264px] w-[516px] self-center lg:block" aria-hidden="true">
      <img
        src={ungu1}
        srcset="{ungu1} 192w, {ungu2} 384w"
        sizes="192px"
        alt=""
        width="192"
        height="209"
        class="absolute bottom-6 left-0 z-[2] h-[210px] w-[192px] object-contain"
      />
      <img
        src={mawar1}
        srcset="{mawar1} 220w, {mawar2} 440w"
        sizes="220px"
        alt=""
        width="220"
        height="240"
        class="absolute bottom-6 left-[140px] z-[3] h-[240px] w-[220px] object-contain"
      />
      <img
        src={amber1}
        srcset="{amber1} 206w, {amber2} 412w"
        sizes="206px"
        alt=""
        width="206"
        height="225"
        class="absolute bottom-6 left-[310px] z-[4] h-[226px] w-[206px] object-contain"
      />
    </div>
  </aside>

  <main
    id="konten"
    tabindex="-1"
    class="flex flex-1 items-start justify-center rounded-t-[1.5rem] bg-surface px-5 py-8 outline-none lg:items-center lg:rounded-[1.25rem] lg:shadow-lembut"
  >
    <div class="w-full max-w-[27.5rem]">{@render children()}</div>
  </main>
</div>

<style>
  /* Latar panel desktop = gambar gradasi titik dari ekspor frame (sama di App 15–20). Gambarnya terang,
     jadi tema gelap tetap memakai latar token agar judul (warna ink tema) terbaca. */
  @media (min-width: 1024px) {
    :global(:root:not([data-theme='dark'])) .panel-akun {
      background: var(--panel-akun) center / 100% 100% no-repeat;
    }
  }
</style>
