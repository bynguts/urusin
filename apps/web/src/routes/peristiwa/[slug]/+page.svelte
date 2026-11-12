<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import ChipSumber from '#lib/components/urusan/ChipSumber.svelte';
  import Lencana from '#lib/components/urusan/Lencana.svelte';
  import Chip from '#lib/components/ui/Chip.svelte';
  import PilihWilayah from '#lib/components/ui/PilihWilayah.svelte';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import { namaPendek } from '#lib/stores/lokal.svelte.js';
  import { tanggal } from '#lib/urusan-status.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const lokal = ambilLokal();
  const p = $derived(data.peristiwa);
  const r = $derived(data.rencana);
  const pesan = $derived(`Saya ingin mengurus ${p.judul.toLowerCase()}. Apa saja yang perlu saya siapkan?`);
  let mengirim = $state(false);
  let pilihKota = $state<HTMLSelectElement>();

  // Dengan JS: bila belum memilih kota dan perangkat ini punya pilihan wilayah, pakai itu (usulan saja).
  // Pilihan warga di kolom (termasuk sebelum hidrasi) tidak ditimpa usulan ini.
  $effect(() => {
    if (data.kodeDipilih || page.url.searchParams.has('kodeKabKota') || pilihKota?.value) return;
    const kode = lokal.data.wilayah?.kodeKabKota;
    if (!kode) return;
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- path lewat resolve(), hanya ditambah query
    void goto(`${resolve('/peristiwa/[slug]', { slug: p.slug })}?kodeKabKota=${kode}`, {
      replaceState: true,
    });
  });

  function simpanWilayah(sel: HTMLSelectElement) {
    const k = data.kota.find((x) => x.kodeKabKota === sel.value);
    if (k) lokal.aturWilayah({ kodeKabKota: k.kodeKabKota, nama: namaPendek(k.nama) });
    sel.form?.requestSubmit();
  }

  const JENIS: Record<string, { label: string; nada: 'ai' | 'anda' | 'instansi' }> = {
    'online-adapter': { label: 'Online · AI bisa bantu mengisi', nada: 'ai' },
    'online-manual': { label: 'Online · Anda isi sendiri', nada: 'anda' },
    offline: { label: 'Datang ke kantor', nada: 'instansi' },
    'cek-kanal': { label: 'Cek cara di Disdukcapil setempat', nada: 'anda' },
  };
</script>

<svelte:head>
  <title>{p.judul} · Urusin</title>
</svelte:head>

<HeaderHalaman judul={p.judul}>
  {#snippet awal()}<Lencana peristiwa={p} />{/snippet}
</HeaderHalaman>

<div class="mx-auto w-full max-w-[52rem] px-4 py-6 sm:px-8 lg:py-10">
  <p class="text-base text-body sm:text-[1.0625rem]">{p.ringkas}.</p>

  <form method="GET" class="mt-6 flex flex-col gap-2" data-sveltekit-keepfocus data-sveltekit-noscroll>
    <label for="kota" class="text-[0.9375rem] font-medium text-ink">Kabupaten/kota sesuai KTP Anda</label>
    <div class="flex flex-wrap items-start gap-2">
      <div class="min-w-0 flex-1">
        <PilihWilayah
          id="kota"
          name="kodeKabKota"
          kota={data.kota}
          value={data.kodeDipilih ?? ''}
          bind:select={pilihKota}
          onchange={simpanWilayah}
          describedby="kota-petunjuk"
        />
      </div>
      <noscript>
        <button
          type="submit"
          class="min-h-12 rounded-full border border-line-2 bg-surface px-5 font-medium text-ink"
          >Tampilkan</button
        >
      </noscript>
    </div>
    <p id="kota-petunjuk" class="text-sm text-muted">
      {data.dariDataDiri ? 'Diisi dari Data Diri akun Anda. ' : ''}Syarat dan situs resmi mengikuti wilayah
      KTP; Urusin memastikannya lagi saat urusan dimulai.
    </p>
  </form>

  {#if r}
    <section aria-labelledby="judul-langkah" class="mt-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="judul-langkah" class="text-xl font-semibold tracking-tight text-ink">
          Rencana · {r.langkah.length} langkah
        </h2>
        {#if r.kota}
          {#if r.tier === 'semi'}
            <Chip nada="ai" ikon="ai">AI bisa bantu mengisi di situs resmi</Chip>
          {:else}
            <Chip nada="netral" ikon="peta">Dipandu langkah demi langkah</Chip>
          {/if}
        {/if}
      </div>
      {#if r.keluaran.length}
        <p class="mt-2 text-[0.9375rem] text-body">Hasil akhirnya: {r.keluaran.join(', ')}.</p>
      {/if}
      {#if r.peringatan}
        <p class="mt-4 flex gap-2 rounded-xl bg-kuning p-4 text-[0.9375rem] text-kuning-ink">
          <Icon name="info" class="mt-0.5 size-4.5 shrink-0" />{r.peringatan}
        </p>
      {/if}

      <ol class="mt-5 flex flex-col">
        {#each r.langkah as l, i (l.id)}
          {@const j = JENIS[l.jenis] ?? JENIS['online-manual']!}
          <li class="relative flex gap-4 pb-7 last:pb-0">
            {#if i < r.langkah.length - 1}
              <span class="absolute top-8 bottom-1 left-[0.9375rem] w-px bg-line-2" aria-hidden="true"></span>
            {/if}
            <span
              class="relative grid size-8 shrink-0 place-items-center rounded-full border border-line-2 bg-surface text-sm font-semibold text-ink"
              >{i + 1}</span
            >
            <div class="min-w-0 flex-1">
              <h3 class="text-[1.0625rem] font-semibold tracking-tight text-ink">{l.judul}</h3>
              <div class="mt-1.5"><Chip nada={j.nada}>{j.label}</Chip></div>
              {#if l.keterangan}<p class="mt-2 text-[0.9375rem] text-body">{l.keterangan}</p>{/if}
              {#if l.dokumen.length}
                <p class="mt-3 text-sm font-semibold text-ink">Dokumen yang disiapkan</p>
                <ul class="mt-1 flex flex-col gap-1.5">
                  {#each l.dokumen as d (d)}
                    <li class="flex gap-2 text-[0.9375rem] text-body">
                      <Icon name="berkas" class="mt-0.5 size-4.5 shrink-0 text-muted" />{d}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if l.bawa.length}
                <p class="mt-3 text-sm font-semibold text-ink">Dibawa saat datang</p>
                <ul class="mt-1 flex flex-col gap-1.5">
                  {#each l.bawa as b (b)}
                    <li class="flex gap-2 text-[0.9375rem] text-body">
                      <Icon name="centang-bulat" class="mt-0.5 size-4.5 shrink-0 text-muted" />{b}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if l.sumber.length}
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each l.sumber as s, k (s.url)}
                    <ChipSumber
                      nomor={k + 1}
                      url={s.url}
                      diperiksa={tanggal(l.verifiedAt) || undefined}
                      perluDicekUlang={!l.verifiedAt}
                    />
                  {/each}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
      {#if r.catatan}
        <p class="mt-6 text-sm text-muted">{r.catatan}</p>
      {/if}
    </section>
  {:else if p.slug === 'lainnya'}
    <p class="mt-8 rounded-2xl bg-card p-5 text-base text-body">
      Ceritakan urusan Anda di Beranda. Urusin mencari aturan resmi untuk wilayah Anda.
    </p>
  {/if}

  <form
    method="POST"
    action="/?/mulai"
    class="sticky bottom-20 mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lembut lg:bottom-4"
    use:enhance={() => {
      mengirim = true;
      lokal.simpanTertunda(pesan);
      return async ({ update }) => {
        await update();
        mengirim = false;
      };
    }}
  >
    <input type="hidden" name="peristiwa" value={p.slug} />
    <input type="hidden" name="pesan" value={pesan} />
    <input type="hidden" name="kodeKabKota" value={data.kodeDipilih ?? ''} />
    <p class="min-w-0 flex-1 text-[0.9375rem] text-body">
      Urusin menemani sampai selesai. Keputusan tetap di petugas instansi.
    </p>
    <button
      type="submit"
      disabled={mengirim}
      aria-busy={mengirim || undefined}
      class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink"
    >
      Mulai urusan ini <Icon
        name={mengirim ? 'memuat' : 'panah'}
        class="size-4.5 {mengirim ? 'animate-spin' : ''}"
      />
    </button>
  </form>
</div>
