<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { Prefs } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import { ambilLokal, ambilPrefs, ambilTts } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const prefs = ambilPrefs();
  const lokal = ambilLokal();
  const tts = ambilTts();
  const akun = $derived(page.data.akun as { email: string | null } | null | undefined);

  const BAGIAN: { id: string; label: string; ikon: NamaIkon }[] = [
    { id: 'tampilan', label: 'Tampilan & suara', ikon: 'huruf' },
    { id: 'wilayah', label: 'Wilayah layanan', ikon: 'lokasi' },
    { id: 'akun', label: 'Akun', ikon: 'orang' },
    { id: 'privasi', label: 'Privasi & data', ikon: 'perisai' },
  ];
  let aktif = $state('tampilan');

  const UKURAN: { nilai: Prefs['ukuranHuruf']; label: string; aa: string }[] = [
    { nilai: 1, label: 'Normal', aa: 'text-base' },
    { nilai: 1.25, label: 'Besar', aa: 'text-xl' },
    { nilai: 1.5, label: 'Sangat besar', aa: 'text-2xl' },
  ];
  const TEMA: { nilai: Prefs['tema']; label: string }[] = [
    { nilai: 'terang', label: 'Terang' },
    { nilai: 'gelap', label: 'Gelap' },
  ];

  let kodeWilayah = $state(lokal.data.wilayah.kodeKabKota);
  let wilayahTersimpan = $state(false);
  function simpanWilayah() {
    const k = data.kota.find((x) => x.kodeKabKota === kodeWilayah);
    if (!k) return;
    lokal.aturWilayah({ kodeKabKota: k.kodeKabKota, nama: k.nama });
    wilayahTersimpan = true;
  }

  let dataDihapus = $state(false);
  function hapusLokal() {
    if (!confirm('Hapus daftar urusan, pesan, dan pengaturan dari perangkat ini?')) return;
    lokal.hapusSemua();
    dataDihapus = true;
  }

  let keluarSibuk = $state(false);
  async function keluar() {
    keluarSibuk = true;
    try {
      await fetch('/api/akun/keluar', { method: 'POST' });
    } finally {
      location.assign(resolve('/'));
    }
  }

  const coba = () =>
    tts.baca('Untuk akta kelahiran, siapkan surat keterangan lahir dari bidan atau rumah sakit.');
</script>

<svelte:head><title>Pengaturan · Urusin</title></svelte:head>

<HeaderHalaman judul="Pengaturan" />

<div class="flex min-h-0 flex-1">
  <nav aria-label="Bagian pengaturan" class="hidden w-[16.25rem] shrink-0 border-r border-line p-4 lg:block">
    <ul class="flex flex-col gap-1">
      {#each BAGIAN as b (b.id)}
        <li>
          <a
            href="#{b.id}"
            onclick={() => (aktif = b.id)}
            aria-current={aktif === b.id ? 'true' : undefined}
            class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[0.9375rem] text-ink {aktif === b.id
              ? 'bg-surface font-semibold shadow-lembut'
              : 'hover:bg-card'}"
          >
            <Icon name={b.ikon} class="size-5" />{b.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="flex min-w-0 flex-1 flex-col gap-10 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
    <section
      id="tampilan"
      aria-labelledby="h-tampilan"
      class="flex max-w-[50rem] scroll-mt-24 flex-col gap-5"
    >
      <div>
        <h2 id="h-tampilan" class="text-[1.625rem] tracking-[-0.03em] text-ink sm:text-[1.75rem]">
          Tampilan & suara
        </h2>
        <p class="mt-1 text-base text-body">Atur supaya Urusin nyaman dibaca dan didengar.</p>
      </div>

      <fieldset class="rounded-kartu border border-line p-4 sm:p-5">
        <legend class="sr-only">Ukuran huruf</legend>
        <p aria-hidden="true" class="text-base font-semibold text-ink">Ukuran huruf</p>
        <div class="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-bg-2 p-1">
          {#each UKURAN as u (u.nilai)}
            {@const pilih = prefs.nilai.ukuranHuruf === u.nilai}
            <label
              class="flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 text-center has-focus-visible:outline-2 has-focus-visible:outline-ink sm:flex-row sm:gap-2.5 {pilih
                ? 'bg-surface shadow-lembut'
                : 'hover:bg-card'}"
            >
              <input
                type="radio"
                name="ukuran"
                class="sr-only"
                checked={pilih}
                onchange={() => prefs.atur('ukuranHuruf', u.nilai)}
              />
              <span aria-hidden="true" class="font-semibold text-ink {u.aa}">Aa</span>
              <span class="text-sm text-ink {pilih ? 'font-semibold' : ''}">{u.label}</span>
              {#if pilih}<Icon name="centang" class="hidden size-4 sm:block" />{/if}
            </label>
          {/each}
        </div>
        <div class="mt-4 rounded-xl bg-card px-4 py-3">
          <p class="text-sm text-muted">Contoh</p>
          <p class="mt-1 text-lg text-ink">
            Untuk akta kelahiran, siapkan surat keterangan lahir dari bidan atau rumah sakit.
          </p>
        </div>
      </fieldset>

      <ul class="overflow-hidden rounded-kartu border border-line">
        {@render saklar(
          'kontras',
          'kontras',
          'Kontras tinggi',
          'Teks dan garis lebih tegas.',
          lokal.data.kontrasTinggi,
          (v) => lokal.atur('kontrasTinggi', v),
        )}
        {@render saklar(
          'gerak',
          'gerak',
          'Kurangi gerakan',
          'Matikan animasi yang tidak perlu.',
          lokal.data.kurangiGerak,
          (v) => lokal.atur('kurangiGerak', v),
        )}
        {#if tts.tersedia}
          {@render saklar(
            'bacakan',
            'bacakan',
            'Bacakan jawaban otomatis',
            'Rose membacakan setiap jawaban dengan suara Bahasa Indonesia.',
            prefs.nilai.bacakanOtomatis,
            (v) => prefs.atur('bacakanOtomatis', v),
            true,
          )}
        {:else}
          <li class="flex items-start gap-4 border-t border-line-3 px-4 py-4 first:border-t-0">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-2"
              ><Icon name="bacakan" class="size-5" /></span
            >
            <span>
              <span class="block font-semibold text-ink">Bacakan jawaban</span>
              <span class="block text-sm text-body"
                >Perangkat ini belum punya suara Bahasa Indonesia untuk membacakan.</span
              >
            </span>
          </li>
        {/if}
      </ul>

      <fieldset class="rounded-kartu border border-line p-4 sm:p-5">
        <legend class="sr-only">Tema</legend>
        <p aria-hidden="true" class="text-base font-semibold text-ink">Tema</p>
        <div class="mt-3 grid max-w-sm grid-cols-2 gap-1 rounded-2xl bg-bg-2 p-1">
          {#each TEMA as t (t.nilai)}
            {@const pilih = (prefs.nilai.tema === 'gelap' ? 'gelap' : 'terang') === t.nilai}
            <label
              class="flex min-h-12 cursor-pointer items-center justify-center rounded-xl text-[0.9375rem] text-ink has-focus-visible:outline-2 has-focus-visible:outline-ink {pilih
                ? 'bg-surface font-semibold shadow-lembut'
                : 'hover:bg-card'}"
            >
              <input
                type="radio"
                name="tema"
                class="sr-only"
                checked={pilih}
                onchange={() => prefs.atur('tema', t.nilai)}
              />
              {t.label}
            </label>
          {/each}
        </div>
      </fieldset>
    </section>

    <section id="wilayah" aria-labelledby="h-wilayah" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      <div>
        <h2 id="h-wilayah" class="text-[1.375rem] tracking-[-0.02em] text-ink">Wilayah layanan</h2>
        <p id="d-wilayah" class="mt-1 text-base text-body">
          Kab/kota tempat KTP Anda terdaftar. Urusin memakai ini untuk memilih situs dan aturan Disdukcapil
          yang benar.
        </p>
      </div>
      <form
        class="flex flex-col gap-3 rounded-kartu border border-line p-4 sm:flex-row sm:items-end sm:p-5"
        onsubmit={(e) => {
          e.preventDefault();
          simpanWilayah();
        }}
      >
        <div class="flex flex-1 flex-col gap-1.5">
          <label for="pilih-wilayah" class="text-[0.9375rem] font-semibold text-ink">Kab/kota</label>
          <select
            id="pilih-wilayah"
            bind:value={kodeWilayah}
            onchange={() => (wilayahTersimpan = false)}
            aria-describedby="d-wilayah"
            autocomplete="address-level2"
            class="h-12 rounded-xl border border-line-2 bg-surface px-3 text-base text-ink"
          >
            {#each data.kota as k (k.kodeKabKota)}<option value={k.kodeKabKota}>{k.nama}</option>{/each}
          </select>
        </div>
        <button
          type="submit"
          class="inline-flex min-h-12 items-center justify-center rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
          >Simpan wilayah</button
        >
      </form>
      <p role="status" class="text-[0.9375rem] text-hijau-ink">
        {#if wilayahTersimpan}Wilayah disimpan: {lokal.data.wilayah.nama}.{/if}
      </p>
    </section>

    <section id="akun" aria-labelledby="h-akun" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      <h2 id="h-akun" class="text-[1.375rem] tracking-[-0.02em] text-ink">Akun</h2>
      <div
        class="flex flex-col gap-3 rounded-kartu border border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        {#if akun}
          <p class="min-w-0 text-base text-ink">
            Masuk sebagai <span class="font-semibold break-all"
              >{akun.email ?? 'salinan demo juri (terhapus dalam 24 jam)'}</span
            >
          </p>
          <div class="flex flex-wrap gap-2">
            <a
              href={resolve('/data-diri')}
              class="inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
              >Data diri</a
            >
            <button
              type="button"
              onclick={keluar}
              disabled={keluarSibuk}
              class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card disabled:opacity-60"
            >
              <Icon name="log-keluar" class="size-4.5" /> Keluar
            </button>
          </div>
        {:else}
          <p class="text-base text-body">
            Masuk supaya data diri dan dokumen tersimpan aman dan bisa dipakai di urusan berikutnya.
          </p>
          <a
            href={resolve('/masuk')}
            class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
            >Masuk</a
          >
        {/if}
      </div>
    </section>

    <section id="privasi" aria-labelledby="h-privasi" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      <div>
        <h2 id="h-privasi" class="text-[1.375rem] tracking-[-0.02em] text-ink">Privasi & data</h2>
        <p class="mt-1 text-base text-body">
          Daftar urusan, pesan yang Anda ketik, dan pengaturan ini disimpan di perangkat ini saja.
        </p>
      </div>
      <div
        class="flex flex-col gap-3 rounded-kartu border border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <p class="text-[0.9375rem] text-body">
          {dataDihapus
            ? 'Data di perangkat ini sudah dihapus.'
            : `${lokal.data.urusan.length} urusan tersimpan di perangkat ini.`}
        </p>
        <button
          type="button"
          onclick={hapusLokal}
          class="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-galat-garis bg-surface px-5 font-semibold text-galat hover:bg-mawar"
        >
          <Icon name="hapus" class="size-4.5" /> Hapus data di perangkat ini
        </button>
      </div>
      {#if page.data.version}
        <p class="text-sm text-muted">Versi {page.data.version}</p>
      {/if}
    </section>
  </div>
</div>

{#snippet saklar(
  id: string,
  ikon: NamaIkon,
  judul: string,
  ket: string,
  nyala: boolean,
  ubah: (v: boolean) => void,
  denganCoba = false,
)}
  <li class="flex items-center gap-4 border-t border-line-3 px-4 py-4 first:border-t-0">
    <span aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-2"
      ><Icon name={ikon} class="size-5" /></span
    >
    <span class="min-w-0 flex-1">
      <span id="s-{id}" class="block font-semibold text-ink">{judul}</span>
      <span id="k-{id}" class="block text-sm text-body">{ket}</span>
    </span>
    {#if denganCoba}
      <button
        type="button"
        onclick={coba}
        class="hidden min-h-12 shrink-0 items-center gap-2 rounded-full border border-line-2 bg-surface px-4 text-[0.9375rem] text-ink hover:bg-card sm:inline-flex"
      >
        <Icon name="putar" class="size-4" /> Coba dengar
      </button>
    {/if}
    <button
      type="button"
      role="switch"
      aria-checked={nyala}
      aria-labelledby="s-{id}"
      aria-describedby="k-{id}"
      onclick={() => ubah(!nyala)}
      class="relative grid h-12 w-16 shrink-0 place-items-center"
    >
      <span class="h-8 w-14 rounded-full transition-colors {nyala ? 'bg-primer' : 'bg-line-2'}"></span>
      <span
        class="absolute top-1/2 left-1/2 -ml-3 size-6 -translate-y-1/2 rounded-full bg-surface shadow-lembut transition-transform {nyala
          ? 'translate-x-3'
          : '-translate-x-3'}"
      ></span>
    </button>
  </li>
{/snippet}
