<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '../Icon.svelte';
  import { bangunLinimasa } from '../urusan/linimasa.js';
  import type { UrusanState } from '#lib/contracts.js';
  import { judulUrusan, peristiwaDariJenis } from '#lib/peristiwa.js';
  import { ambilLokal, ambilPrefs, ambilTts } from '#lib/stores/app.svelte.js';
  import type { PesanWarga } from '#lib/stores/lokal.svelte.js';
  import { UrusanStore } from '#lib/stores/urusan.svelte.js';
  import { FASE, faseUrusan, infoStatus, tanggal } from '#lib/urusan-status.js';

  /** Ringkasan urusan terakhir (frame uCOBS/aK2Ex desktop, IzXAR/YDPGe HP), tersambung ke stream urusan. */
  type Ringkas = {
    id: string;
    jenis: string | null;
    kodeKabKota: string | null;
    namaKota: string | null;
    state: UrusanState;
    dibuatPada: string;
    diubahPada: string;
  };
  let { urusan, demo }: { urusan: Ringkas; demo: boolean } = $props();

  const lokal = ambilLokal();
  const prefs = ambilPrefs();
  const tts = ambilTts();
  const store = new UrusanStore();

  let pesan = $state<PesanWarga[]>([]);
  let teks = $state('');
  let mengirim = $state(false);
  let galatKirim = $state<string | null>(null);
  let bisaDikte = $state(false);
  let mendikte = $state(false);
  let hentikanDikte: (() => void) | undefined;

  const k = $derived(store.keadaan);
  const keadaanUrusan = $derived(k.state ?? urusan.state);
  const p = $derived(peristiwaDariJenis(urusan.jenis));
  const judul = $derived(judulUrusan(urusan.jenis) ?? lokal.cari(urusan.id)?.judul ?? 'Urusan Anda');
  const kota = $derived(urusan.namaKota ?? lokal.data.wilayah.nama);
  const akun = $derived(page.data.akun as { email: string; nama?: string | null } | null | undefined);
  const sapaan = $derived(akun?.nama ? `Kita lanjutkan, ${akun.nama.split(' ')[0]}.` : 'Kita lanjutkan.');
  const dibuka = $derived(
    new Date(urusan.diubahPada).toDateString() === new Date().toDateString()
      ? 'hari ini'
      : tanggal(urusan.diubahPada),
  );
  const fase = $derived(faseUrusan(keadaanUrusan));
  const info = $derived(infoStatus(keadaanUrusan));
  const linimasa = $derived(bangunLinimasa(k.events, pesan));
  const pertanyaan = $derived(pesan.at(-1)?.teks ?? null);
  const jawaban = $derived.by(() => {
    if (k.sedangBerjalan && k.progres) return k.progres;
    for (let i = linimasa.length - 1; i >= 0; i--) {
      const it = linimasa[i];
      if (it?.jenis === 'teks') return it.teks;
      if (it?.jenis === 'jawaban') return it.e.klaim.map((x) => x.teks).join(' ');
      if (it?.jenis === 'handoff') return it.e.alasan;
    }
    return null;
  });
  const dokumen = $derived.by(() => {
    if (k.checklist) return k.checklist.item;
    const bawa = new Set(k.rencana?.langkah.flatMap((l) => l.bawa) ?? []);
    return [...bawa].map((label, i) => ({ id: `b${i}`, label, status: 'perlu' as const, alasan: undefined }));
  });
  const perhatian = $derived(dokumen.find((d) => d.status === 'kurang'));
  const sumber = $derived(k.rencana?.langkah.flatMap((l) => l.sumber)[0] ?? null);
  const memuat = $derived(k.status === 'menghubungkan' && k.events.length === 0);

  const STATUS_DOK = {
    ok: { label: 'Siap diperiksa', kelas: 'bg-hijau text-hijau-ink', ket: 'Berkas sudah ditambahkan' },
    kurang: {
      label: 'Perlu diperbaiki',
      kelas: 'bg-kuning text-kuning-ink',
      ket: 'Ada bagian yang perlu diperbaiki',
    },
    perlu: { label: 'Belum ditambahkan', kelas: 'bg-bg-2 text-muted', ket: 'Siapkan berkas ini' },
  } as const;

  $effect(() => {
    const id = urusan.id;
    untrack(() => {
      pesan = lokal.pesanWarga(id);
      store.sambung(id);
    });
    bisaDikte = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    return () => store.putus();
  });

  async function kirim(e: SubmitEvent) {
    e.preventDefault();
    const t = teks.trim();
    if (!t || mengirim) return;
    mengirim = true;
    galatKirim = null;
    const setelahSeq = k.lastSeq;
    const hasil = await store.kirim(t);
    mengirim = false;
    if (hasil === 'ok') {
      lokal.catatPesan(urusan.id, { teks: t, setelahSeq });
      teks = '';
      await goto(resolve('/urusan/[id]', { id: urusan.id }));
    } else {
      galatKirim =
        hasil === 'konflik'
          ? 'Urusin masih menjawab. Pesan Anda tetap di sini; kirim lagi sebentar.'
          : 'Pesan belum terkirim. Periksa koneksi, lalu coba lagi.';
    }
  }

  async function bicara() {
    if (mendikte) {
      hentikanDikte?.();
      return;
    }
    mendikte = true;
    const { mulaiDikte } = await import('#lib/suara.js');
    hentikanDikte = mulaiDikte(
      (t) => (teks = t),
      () => (mendikte = false),
    );
  }
</script>

<!-- Bilah atas desktop -->
<div class="hidden h-[4.5rem] items-center justify-between border-b border-line px-7 lg:flex">
  <p class="text-base font-semibold">Ruang urusan Anda</p>
  <div class="flex items-center gap-8">
    <a
      href="{resolve('/pengaturan')}#wilayah"
      class="flex min-h-11 items-center gap-2.5 text-[0.9375rem] hover:opacity-70"
    >
      <Icon name="lokasi" class="size-[1.125rem]" />
      {kota}
      <Icon name="bawah" class="size-4" />
      <span class="sr-only">(ubah wilayah)</span>
    </a>
    <button
      type="button"
      aria-pressed={prefs.nilai.bacakanOtomatis}
      onclick={() => prefs.atur('bacakanOtomatis', !prefs.nilai.bacakanOtomatis)}
      class="flex min-h-11 items-center gap-2.5 text-base font-semibold hover:opacity-70"
    >
      <Icon name="bacakan" class="size-[1.125rem]" /> Bantuan suara
    </button>
    {#if demo}
      <span class="-ml-3 rounded-full bg-bg-2 px-3 py-1.5 text-[0.8125rem] font-semibold text-muted"
        >Mode demo</span
      >
    {/if}
  </div>
</div>

<div class="px-5 pt-7 pb-10 lg:px-8 lg:pt-7 lg:pb-16">
  <h1 class="text-[1.75rem] leading-[1.2] font-normal tracking-[-0.035em] lg:text-[2rem]">{sapaan}</h1>
  <p class="mt-3 text-[0.9375rem] leading-[1.6] text-muted lg:mt-2.5">
    {judul} · {kota} · Terakhir dibuka {dibuka}
  </p>

  <div class="mt-6 flex flex-col gap-6 lg:mt-7 lg:grid lg:grid-cols-[1fr_21.25rem] lg:items-start">
    <!-- Kolom utama -->
    <div class="contents lg:flex lg:flex-col">
      <section
        aria-label="Percakapan terakhir"
        class="order-2 rounded-[1.25rem] border border-line bg-surface p-5 lg:p-7"
      >
        <p class="flex items-center gap-3 text-lg font-semibold">
          <Icon name="ai" class="size-6 text-brand" /> Urusin
        </p>
        {#if memuat}
          <div class="mt-5 flex flex-col gap-3" aria-hidden="true">
            <span class="h-4 w-2/3 animate-pulse rounded bg-bg-2"></span>
            <span class="h-4 w-full animate-pulse rounded bg-bg-2"></span>
          </div>
          <p class="sr-only" role="status">Memuat percakapan…</p>
        {:else}
          {#if pertanyaan}
            <p class="mt-5 text-[1.0625rem] leading-[1.6] lg:mt-5">“{pertanyaan}”</p>
          {/if}
          {#if jawaban}
            <p class="mt-4 text-[1.0625rem] leading-[1.65] lg:mt-5">{jawaban}</p>
          {/if}
        {/if}

        {#if perhatian}
          <div
            class="mt-6 flex flex-col gap-5 rounded-2xl bg-bg-2 p-5 lg:mt-7 lg:flex-row lg:items-center lg:gap-6 lg:px-6 lg:py-[2.375rem]"
          >
            <div class="rounded border border-line bg-surface px-4 pt-5 pb-5 lg:w-60" aria-hidden="true">
              <p class="text-center text-[0.8125rem] font-semibold uppercase">{perhatian.label}</p>
              <span class="mt-4 block h-1.5 w-[75%] rounded bg-line"></span>
              <span class="mt-2.5 block h-1.5 w-[62%] rounded bg-line"></span>
              <span class="mt-2.5 block h-1.5 w-[75%] rounded bg-line"></span>
            </div>
            <div class="flex items-center gap-3 lg:block">
              <Icon name="pindai" class="size-7 text-kuning-ink" />
              <p class="text-[0.9375rem] font-semibold lg:mt-3">Berkas belum utuh</p>
              <p class="mt-2 hidden text-[0.8125rem] text-muted lg:block">Pratinjau disamarkan</p>
            </div>
          </div>
        {/if}

        <div class="mt-5 rounded-2xl bg-card px-[1.125rem] py-4 lg:mt-[1.125rem]">
          <p class="flex items-center gap-3 text-lg font-semibold lg:text-[1.1875rem]">
            <Icon name={perhatian ? 'kamera' : 'rencana'} class="size-5 shrink-0 text-kuning-ink" />
            {perhatian ? `Perbaiki ${perhatian.label}` : info.aksi}
          </p>
          <p class="mt-2 text-[0.9375rem] leading-[1.6] text-muted">
            {perhatian?.alasan ?? FASE[fase - 1].ket}
          </p>
        </div>

        <div class="mt-5 flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:gap-5">
          <a
            href={perhatian ? resolve('/dokumen') : resolve('/urusan/[id]', { id: urusan.id })}
            class="inline-flex h-[3.25rem] items-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90"
          >
            <Icon name="panah" class="size-[1.125rem]" />
            {perhatian ? 'Perbaiki berkas' : info.aksi}
          </a>
          <a
            href={resolve('/urusan/[id]', { id: urusan.id })}
            class="inline-flex min-h-12 items-center text-base font-semibold hover:opacity-70"
            >Lihat rencana</a
          >
        </div>

        <button
          type="button"
          disabled={!tts.tersedia || !jawaban}
          onclick={() => (tts.membaca ? tts.berhenti() : tts.baca(jawaban ?? ''))}
          class="mt-4 inline-flex min-h-12 items-center gap-2.5 text-base font-semibold hover:opacity-70 disabled:opacity-50"
        >
          <Icon name="bacakan" class="size-[1.125rem]" />
          {tts.membaca ? 'Hentikan bacaan' : 'Bacakan jawaban'}
        </button>

        <form onsubmit={kirim} class="mt-4 rounded-2xl border border-line bg-bg px-5 pt-5 pb-5">
          <label for="tanya-ringkasan" class="sr-only">Tulis pertanyaan Anda</label>
          <textarea
            id="tanya-ringkasan"
            bind:value={teks}
            rows="1"
            maxlength="2000"
            placeholder="Tulis pertanyaan Anda..."
            class="block w-full resize-none bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
          ></textarea>
          {#if galatKirim}
            <p role="alert" class="mt-2 text-sm font-medium text-galat">{galatKirim}</p>
          {/if}
          <div class="mt-3 flex items-center justify-between">
            {#if bisaDikte}
              <button
                type="button"
                onclick={bicara}
                aria-pressed={mendikte}
                class="inline-flex min-h-12 items-center gap-2.5 text-base font-semibold"
              >
                <Icon name="mikrofon" class="size-[1.125rem]" />
                {mendikte ? 'Mendengarkan…' : 'Bicara'}
              </button>
            {:else}
              <span></span>
            {/if}
            <button
              type="submit"
              disabled={mengirim}
              aria-busy={mengirim || undefined}
              class="grid size-11 place-items-center rounded-full bg-primer text-primer-ink hover:opacity-90"
              aria-label="Kirim pertanyaan"
            >
              <Icon
                name={mengirim ? 'memuat' : 'panah-atas'}
                class="size-5 {mengirim ? 'animate-spin' : ''}"
              />
            </button>
          </div>
        </form>
      </section>

      {#if sumber}
        <div class="order-3 lg:mt-10">
          <p class="text-[0.875rem] font-semibold">{sumber.instansi} · Rujukan layanan</p>
          <p class="mt-3 text-[0.8125rem] leading-[1.6] text-muted lg:mt-2.5">
            Persyaratan kondisi keluarga Anda perlu dikonfirmasi ke layanan resmi.
          </p>
          <a
            href={sumber.url}
            target="_blank"
            rel="external noopener noreferrer"
            class="mt-2 inline-flex min-h-12 items-center gap-2.5 text-base font-semibold hover:opacity-70"
          >
            <Icon name="tautan-luar" class="size-[1.125rem]" /> Buka sumber resmi
            <span class="sr-only">(tab baru)</span>
          </a>
        </div>
      {/if}

      <section
        aria-labelledby="judul-bantuan-browser"
        class="order-4 rounded-2xl bg-bg-2 p-[1.125rem] lg:mt-6"
      >
        <h2 id="judul-bantuan-browser" class="text-lg font-semibold tracking-[-0.02em]">
          Bantuan browser, saat Anda siap.
        </h2>
        <p class="mt-2 text-[0.9375rem] leading-[1.6] text-muted">
          Anda meninjau izin sebelum dibantu mengisi. Login, OTP, dan pengiriman akhir tetap Anda lakukan.
        </p>
        <p class="mt-1.5 text-[0.8125rem] text-muted">Browser Pendamping · belum dimulai</p>
        <a
          href={resolve('/urusan/[id]', { id: urusan.id })}
          class="mt-4 inline-flex h-11 items-center rounded-full bg-surface px-4 text-[0.9375rem] font-semibold shadow-lembut hover:opacity-90"
          >Lihat bantuan browser</a
        >
      </section>

      {#if demo}
        <p class="order-6 text-[0.8125rem] text-muted lg:mt-8">
          Mode demo: jawaban Urusin di layar ini berasal dari skenario contoh.
        </p>
      {/if}
    </div>

    <!-- Kolom kanan -->
    <div class="contents lg:flex lg:flex-col lg:gap-6">
      <section
        aria-labelledby="judul-fase"
        class="order-1 rounded-[1.25rem] border border-line bg-card px-[1.375rem] pt-6 pb-6"
      >
        <div class="flex items-start justify-between gap-3">
          <h2 id="judul-fase" class="text-[1.375rem] leading-[1.2] font-normal tracking-[-0.03em]">
            {judul}
          </h2>
          <Icon name={p.icon} class="size-7 shrink-0 text-hijau-ink" />
        </div>
        <p class="mt-3 text-[0.875rem] text-muted">Untuk keluarga Anda · {kota}</p>
        <p class="mt-5 text-[0.9375rem] font-semibold">Langkah {fase} dari 4 · {FASE[fase - 1].judul}</p>
        <div class="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
          {#each FASE as f, i (f.judul)}
            <span class="h-1 rounded-full {i < fase ? 'bg-hijau-ink' : 'bg-line'}"></span>
          {/each}
        </div>
        <p class="mt-5 text-[0.8125rem] leading-[1.6] text-muted">{FASE[fase - 1].ket}</p>
      </section>

      <section
        aria-labelledby="judul-dokumen"
        class="order-5 rounded-[1.25rem] border border-line bg-card px-5 pt-7 pb-5"
      >
        <div class="flex items-center justify-between">
          <h2 id="judul-dokumen" class="text-[1.0625rem] font-normal tracking-[-0.02em]">
            Dokumen yang disiapkan
          </h2>
          <a
            href={resolve('/dokumen')}
            class="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold">Kelola</a
          >
        </div>
        <p class="mt-4 text-[0.8125rem] leading-[1.6] text-muted">
          Berkas dari rencana urusan ini, bukan daftar persyaratan lengkap.
        </p>
        {#if dokumen.length}
          <ul class="mt-2">
            {#each dokumen as d (d.id)}
              {@const st = STATUS_DOK[d.status]}
              <li class="border-b border-line pt-6 pb-5">
                <span class="grid size-11 place-items-center rounded-lg bg-bg-2">
                  <Icon name="berkas-teks" class="size-5" />
                </span>
                <p class="mt-4 text-[0.9375rem] font-semibold">{d.label}</p>
                <p class="mt-1.5 text-[0.8125rem] text-muted">{d.alasan ?? st.ket}</p>
                <span
                  class="mt-3 inline-flex h-8 items-center rounded-full px-3 text-[0.8125rem] font-semibold {st.kelas}"
                  >{st.label}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-5 border-b border-line pb-5 text-[0.875rem] text-muted">
            {memuat ? 'Memuat daftar berkas…' : 'Daftar berkas muncul setelah rencana disusun.'}
          </p>
        {/if}
        <p class="mt-3 flex gap-3 text-[0.8125rem] leading-[1.6] text-muted">
          <Icon name="gembok" class="mt-0.5 size-4 shrink-0" />
          Berkas asli disimpan terenkripsi. Penggunaan data perlu persetujuan Anda.
        </p>
      </section>

      <a
        href={resolve('/jejak/[id]', { id: urusan.id })}
        class="order-7 inline-flex min-h-12 items-center gap-2.5 self-start text-base font-semibold hover:opacity-70 lg:self-end"
      >
        <Icon name="riwayat" class="size-[1.125rem]" /> Lihat riwayat bantuan
      </a>
    </div>
  </div>
</div>
