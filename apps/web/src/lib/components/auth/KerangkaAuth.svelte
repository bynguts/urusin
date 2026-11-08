<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import amberJempol from '#lib/assets/img/amber-jempol.webp';
  import purpleLaptop from '#lib/assets/img/purple-laptop.webp';
  import roseMelambai from '#lib/assets/img/rose-melambai.webp';
  import Lockup from '../shell/Lockup.svelte';

  /**
   * Layar akun App 15–20: panel brand (judul besar + tiga karakter) di kiri, formulir di kartu kanan.
   * Di HP panel brand diringkas menjadi lockup + judul di atas formulir.
   */
  let { judul, sub, children }: { judul: string; sub: string; children: Snippet } = $props();
</script>

<div class="flex min-h-dvh flex-col gap-3 bg-bg-2 p-0 lg:flex-row lg:p-3">
  <aside
    class="pola-titik relative flex flex-col overflow-hidden bg-gradient-to-b from-[#f9e9e0] via-bg to-bg-2 px-5 pt-5 pb-6 lg:w-[44.5%] lg:shrink-0 lg:rounded-[1.25rem] lg:border lg:border-line lg:px-10 lg:pt-12"
  >
    <a href={resolve('/')} class="flex h-12 w-fit items-center"><Lockup class="h-9 w-auto lg:h-11" /></a>
    <p
      class="mt-5 max-w-[26rem] text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink lg:mt-14 lg:text-[2.375rem]"
    >
      {judul}
    </p>
    <p class="mt-2 max-w-[32rem] text-[0.9375rem] text-body lg:mt-3 lg:text-base">{sub}</p>
    <div class="mt-auto hidden items-end justify-center pt-10 lg:flex" aria-hidden="true">
      <img src={purpleLaptop} alt="" width="120" height="200" class="-mx-7 h-48 w-auto" />
      <img src={roseMelambai} alt="" width="130" height="230" class="-mx-7 h-56 w-auto" />
      <img src={amberJempol} alt="" width="130" height="210" class="-mx-7 h-52 w-auto" />
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
