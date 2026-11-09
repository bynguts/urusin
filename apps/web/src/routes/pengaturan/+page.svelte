<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { Prefs } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import ZonaBahaya from '#lib/components/akun/ZonaBahaya.svelte';
  import { ambilLokal, ambilPrefs, ambilTts } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const prefs = ambilPrefs();
  const lokal = ambilLokal();
  const tts = ambilTts();
  const akun = $derived(page.data.akun as { email: string | null } | null | undefined);

  const BAGIAN: { id: string; label: string; ikon: NamaIkon }[] = [
    { id: 'tampilan', label: 'Tampilan & suara', ikon: 'huruf' },
    { id: 'wilayah', label: 'Wilayah layanan', ikon: 'lokasi' },
    { id: 'akun', label: 'Keluarga', ikon: 'keluarga' },
    { id: 'privasi', label: 'Privasi & data', ikon: 'perisai-centang' },
  ];
  let aktif = $state('tampilan');

  const UKURAN: { nilai: Prefs['ukuranHuruf']; label: string; aa: string }[] = [
    { nilai: 1, label: 'Normal', aa: 'text-base leading-4' },
    { nilai: 1.25, label: 'Besar', aa: 'text-xl leading-5' },
    { nilai: 1.5, label: 'Sangat besar', aa: 'text-2xl leading-6' },
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

  // Google: tautkan (butuh masuk <= 15 menit; server mengarahkan ke masuk ulang) atau lepas.
  let google = $state<{ aktif: boolean; tertaut: boolean } | null>(null);
  let pesanGoogle = $state('');
  $effect(() => {
    if (!akun?.email) return;
    void fetch('/api/akun', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { metode?: { google: boolean }; akun?: { terhubungGoogle: boolean } } | null) => {
        if (s?.akun) google = { aktif: s.metode?.google ?? false, tertaut: s.akun.terhubungGoogle };
      });
  });
  async function lepasGoogle() {
    if (!confirm('Lepas akun Google? Setelah ini masuk memakai email dan kata sandi.')) return;
    const r = await fetch('/api/akun/google/lepas', { method: 'POST' });
    const j = (await r.json().catch(() => null)) as { pesanWarga?: string } | null;
    if (r.ok && google) google = { ...google, tertaut: false };
    pesanGoogle = r.ok ? 'Google sudah dilepas.' : (j?.pesanWarga ?? 'Gagal melepas Google. Coba lagi.');
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
  <nav
    aria-label="Bagian pengaturan"
    class="hidden w-[259.5px] shrink-0 border-r border-line bg-card px-4 py-5 lg:block"
  >
    <ul class="flex flex-col gap-1">
      {#each BAGIAN as b (b.id)}
        <li>
          <a
            href="#{b.id}"
            onclick={() => (aktif = b.id)}
            aria-current={aktif === b.id ? 'true' : undefined}
            class="flex h-12 items-center gap-2.5 rounded-xl px-3 text-base leading-[23px] {aktif === b.id
              ? 'bg-surface font-semibold text-ink shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
              : 'text-card-ink hover:bg-surface/60'}"
          >
            <Icon name={b.ikon} class="size-[18px] text-ink" />{b.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="flex min-w-0 flex-1 flex-col gap-10 px-4 py-6 sm:px-8 lg:px-12 lg:py-8">
    <section
      id="tampilan"
      aria-labelledby="h-tampilan"
      class="flex max-w-[50rem] scroll-mt-24 flex-col gap-5"
    >
      <div class="flex flex-col gap-1.5">
        <h2
          id="h-tampilan"
          class="text-[26px] leading-8 font-semibold tracking-[-0.7px] text-ink sm:text-[28px]"
        >
          Tampilan & suara
        </h2>
        <p class="text-base text-body sm:text-[17px] sm:leading-[25px]">
          Atur supaya Urusin nyaman dibaca dan didengar.
        </p>
      </div>

      <fieldset class="flex flex-col gap-4 rounded-[18px] border border-line p-4 sm:p-[22px]">
        <legend class="sr-only">Ukuran huruf</legend>
        <p aria-hidden="true" class="text-lg leading-[26px] font-semibold text-ink">Ukuran huruf</p>
        <div class="grid grid-cols-3 gap-1.5 rounded-2xl bg-bg-2 p-[5px]">
          {#each UKURAN as u (u.nilai)}
            {@const pilih = prefs.nilai.ukuranHuruf === u.nilai}
            <label
              class="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 text-center has-focus-visible:outline-2 has-focus-visible:outline-ink sm:flex-row sm:gap-2.5 {pilih
                ? 'bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
                : 'hover:bg-surface/60'}"
            >
              <input
                type="radio"
                name="ukuran"
                class="sr-only"
                checked={pilih}
                onchange={() => prefs.atur('ukuranHuruf', u.nilai)}
              />
              <span aria-hidden="true" class="font-semibold text-ink {u.aa}">Aa</span>
              <span
                class="text-sm sm:text-[15px] sm:leading-[22px] {pilih
                  ? 'font-semibold text-ink'
                  : 'text-card-ink'}">{u.label}</span
              >
              {#if pilih}<Icon name="centang" class="hidden size-4 sm:block" />{/if}
            </label>
          {/each}
        </div>
        <div class="flex flex-col gap-1.5 rounded-xl bg-card px-[18px] py-3.5">
          <p class="text-sm leading-5 text-muted">Contoh</p>
          <p class="text-lg text-ink sm:text-xl sm:leading-[30px]">
            Untuk akta kelahiran, siapkan surat keterangan lahir dari bidan atau rumah sakit.
          </p>
        </div>
      </fieldset>

      <ul class="overflow-hidden rounded-[18px] border border-line">
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
          <li class="flex items-start gap-3.5 border-t border-line px-4 py-4 first:border-t-0 sm:px-[22px]">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-2"
              ><Icon name="bacakan" class="size-[18px]" /></span
            >
            <span class="flex flex-col gap-0.5">
              <span class="text-[17px] leading-[25px] font-semibold text-ink">Bacakan jawaban</span>
              <span class="text-[15px] leading-[22px] text-muted"
                >Perangkat ini belum punya suara Bahasa Indonesia untuk membacakan.</span
              >
            </span>
          </li>
        {/if}
      </ul>

      <fieldset class="flex flex-col gap-4 rounded-[18px] border border-line p-4 sm:p-[22px]">
        <legend class="sr-only">Tema</legend>
        <p aria-hidden="true" class="text-lg leading-[26px] font-semibold text-ink">Tema</p>
        <div class="grid max-w-sm grid-cols-2 gap-1.5 rounded-2xl bg-bg-2 p-[5px]">
          {#each TEMA as t (t.nilai)}
            {@const pilih = (prefs.nilai.tema === 'gelap' ? 'gelap' : 'terang') === t.nilai}
            <label
              class="flex min-h-12 cursor-pointer items-center justify-center rounded-xl text-[15px] leading-[22px] has-focus-visible:outline-2 has-focus-visible:outline-ink {pilih
                ? 'bg-surface font-semibold text-ink shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
                : 'text-card-ink hover:bg-surface/60'}"
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
      <div class="flex flex-col gap-1.5">
        <h2 id="h-wilayah" class="text-[22px] leading-[30px] font-semibold tracking-[-0.5px] text-ink">
          Wilayah layanan
        </h2>
        <p id="d-wilayah" class="text-base leading-[25px] text-body">
          Kab/kota tempat KTP Anda terdaftar. Urusin memakai ini untuk memilih situs dan aturan Disdukcapil
          yang benar.
        </p>
      </div>
      <form
        class="flex flex-col gap-3 sm:flex-row sm:items-end rounded-[18px] border border-line p-4 sm:p-[22px]"
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
      <h2 id="h-akun" class="text-[22px] leading-[30px] font-semibold tracking-[-0.5px] text-ink">
        Keluarga
      </h2>
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-[18px] border border-line p-4 sm:p-[22px]"
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
              >Data diri keluarga</a
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
          {#if google && (google.tertaut || google.aktif)}
            <div data-google class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {#if google.tertaut}
                <button
                  type="button"
                  onclick={lepasGoogle}
                  class="inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
                  >Lepas Google</button
                >
              {:else}
                <form method="GET" action="/auth/google" data-sveltekit-reload>
                  <input type="hidden" name="next" value="/pengaturan" />
                  <button
                    type="submit"
                    class="inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
                    >Tautkan Google</button
                  >
                </form>
              {/if}
              {#if pesanGoogle}<p role="status" class="text-[0.9375rem] text-body">{pesanGoogle}</p>{/if}
            </div>
          {/if}
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

    {#if data.zonaBahaya}
      <ZonaBahaya punyaSandi={data.zonaBahaya.punyaSandi} galat={form ?? null} />
    {/if}

    <section id="privasi" aria-labelledby="h-privasi" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <h2 id="h-privasi" class="text-[22px] leading-[30px] font-semibold tracking-[-0.5px] text-ink">
          Privasi & data
        </h2>
        <p class="text-base leading-[25px] text-body">
          Daftar urusan dan pengaturan ini disimpan di perangkat ini. Data Diri dan dokumen disimpan
          terenkripsi di server: terhapus 72 jam setelah dibuat bila tanpa akun, atau ikut akun Anda sampai
          Anda menghapusnya.
        </p>
      </div>
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-[18px] border border-line p-4 sm:p-[22px]"
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
      {#if page.data.versi}
        <p class="text-sm text-muted" data-versi>
          {#if page.data.versi.commit}
            <a
              href={page.data.versi.commit}
              rel="external noopener"
              class="underline underline-offset-2 hover:text-ink">v{page.data.versi.sha7}</a
            >
          {:else}
            v{page.data.versi.sha7}
          {/if}
        </p>
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
  <li class="flex items-center gap-3.5 border-t border-line px-4 py-4 first:border-t-0 sm:px-[22px]">
    <span aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-xl bg-bg-2"
      ><Icon name={ikon} class="size-[18px]" /></span
    >
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span id="s-{id}" class="text-[17px] leading-[25px] font-semibold text-ink">{judul}</span>
      <span id="k-{id}" class="text-[15px] leading-[22px] text-muted">{ket}</span>
    </span>
    {#if denganCoba}
      <button
        type="button"
        onclick={coba}
        class="hidden h-11 shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-surface px-3.5 text-[15px] leading-[22px] text-ink hover:bg-card sm:inline-flex"
      >
        <Icon name="putar" class="size-3.5" /> Coba dengar
      </button>
    {/if}
    <button
      type="button"
      role="switch"
      aria-checked={nyala}
      aria-labelledby="s-{id}"
      aria-describedby="k-{id}"
      onclick={() => ubah(!nyala)}
      class="relative -my-2 grid h-12 w-14 shrink-0 place-items-center"
    >
      <span class="h-8 w-14 rounded-full transition-colors {nyala ? 'bg-primer' : 'bg-line-2'}"></span>
      <span
        class="absolute top-1/2 left-1/2 -ml-[13px] size-[26px] -translate-y-1/2 rounded-full bg-surface transition-transform {nyala
          ? 'translate-x-3'
          : '-translate-x-3'}"
      ></span>
    </button>
  </li>
{/snippet}
