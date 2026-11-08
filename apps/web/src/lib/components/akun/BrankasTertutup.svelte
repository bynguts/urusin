<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import objPerisai from '#lib/assets/img/obj-perisai.webp';

  /** Keadaan brankas saat belum masuk (401) atau server belum punya brankas (404). */
  let { alasan, pesan }: { alasan: 'perlu-masuk' | 'belum-tersedia' | 'galat'; pesan: string } = $props();
  const next = $derived(page.url.pathname);
</script>

<div class="mt-6 flex flex-col items-center gap-3 rounded-kartu bg-card px-6 py-10 text-center">
  <img src={objPerisai} alt="" width="96" height="96" class="size-24" />
  {#if alasan === 'perlu-masuk'}
    <p class="text-lg font-semibold text-ink">Masuk untuk membuka brankas</p>
    <p class="max-w-md text-[0.9375rem] text-body">
      Data diri dan dokumen disimpan terenkripsi di akun Anda, jadi perlu masuk dulu.
    </p>
    <a
      href="{resolve('/masuk')}?next={encodeURIComponent(next)}"
      class="mt-2 inline-flex min-h-12 items-center rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
      >Masuk</a
    >
  {:else}
    <p class="text-lg font-semibold text-ink">
      {alasan === 'belum-tersedia' ? 'Brankas belum tersedia' : 'Brankas belum bisa dibuka'}
    </p>
    <p role={alasan === 'galat' ? 'alert' : undefined} class="max-w-md text-[0.9375rem] text-body">{pesan}</p>
  {/if}
</div>
