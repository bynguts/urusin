<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { PERISTIWA, URUSAN_LAIN } from '#lib/peristiwa.js';
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Urusin: urus layanan publik bersama</title>
</svelte:head>

<section aria-labelledby="judul-peristiwa">
  <h1 class="text-2xl leading-tight font-bold sm:text-3xl">Mau mengurus apa hari ini?</h1>
  <p class="mt-2 text-slate-600">
    Pilih peristiwa yang sedang Anda alami. Urusin menyiapkan daftar syarat dan langkahnya, lalu menemani
    sampai selesai di situs resmi.
  </p>

  <h2 id="judul-peristiwa" class="mt-6 text-sm font-semibold tracking-wide text-slate-500 uppercase">
    Peristiwa Hidup
  </h2>
  <ul class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
    {#each PERISTIWA as p (p.slug)}
      <li>
        <a
          href={resolve('/peristiwa/[slug]', { slug: p.slug })}
          class="flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <span class="rounded-lg bg-brand-50 p-2 text-brand-700"><Icon name={p.icon} /></span>
          <span class="flex-1">
            <span class="block font-semibold">{p.judul}</span>
            <span class="mt-0.5 block text-sm text-slate-600">{p.ringkas}</span>
          </span>
          <Icon name="panah" class="mt-1 size-5 text-slate-400" />
        </a>
      </li>
    {/each}
    <li class="sm:col-span-2">
      <a
        href={resolve('/peristiwa/[slug]', { slug: URUSAN_LAIN.slug })}
        class="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span class="rounded-lg bg-slate-100 p-2 text-slate-700"><Icon name={URUSAN_LAIN.icon} /></span>
        <span class="flex-1">
          <span class="block font-semibold">{URUSAN_LAIN.judul}</span>
          <span class="mt-0.5 block text-sm text-slate-600">{URUSAN_LAIN.ringkas}</span>
        </span>
        <Icon name="panah" class="mt-1 size-5 text-slate-400" />
      </a>
    </li>
  </ul>
</section>

<section id="urusanku" aria-labelledby="judul-urusanku" class="mt-10 scroll-mt-20">
  <h2 id="judul-urusanku" class="text-lg font-semibold">Urusanku</h2>
  <p class="mt-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
    Belum ada urusan yang berjalan. Urusan yang Anda mulai akan muncul di sini beserta statusnya.
  </p>
</section>

<section id="bantuan" aria-labelledby="judul-bantuan" class="mt-10 scroll-mt-20">
  <h2 id="judul-bantuan" class="text-lg font-semibold">Cara kerja Urusin</h2>
  <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
    <li>Ceritakan kebutuhan Anda; Urusin mencari syarat dari sumber resmi.</li>
    <li>Urusin membantu mengisi formulir di situs resmi, sementara data pribadi tetap di perangkat Anda.</li>
    <li>Tombol kirim terakhir selalu Anda tekan sendiri.</li>
  </ol>
</section>
