<script lang="ts">
  import { enhance } from '$app/forms';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import polaHero from '#lib/assets/img/pen-landing/hero-pattern-fcb3-1440.webp';
  import panggungMawar from '#lib/assets/img/app/panggung-mawar.webp';
  import panggungDaun from '#lib/assets/img/app/panggung-daun.webp';
  import panggungUngu from '#lib/assets/img/app/panggung-ungu.webp';
  import panggungBiru from '#lib/assets/img/app/panggung-biru.webp';
  import Icon from '#lib/components/Icon.svelte';
  import KartuBerjalan from '#lib/components/urusan/KartuBerjalan.svelte';
  import { DaftarUrusan } from '#lib/components/urusan/daftar.svelte.js';
  import LampiranKecil from '#lib/components/urusan/LampiranKecil.svelte';
  import {
    aksiEnter,
    buatLampiran,
    LAMPIRAN_MAKS,
    titipkanPesanAwal,
    type Lampiran,
  } from '#lib/components/urusan/komposer.js';
  import { PERISTIWA, type Warna } from '#lib/peristiwa.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  /** Beranda = App 01 (y9I9Jw) dari pen Rafi: kotak cerita, empat peristiwa hidup, urusan berjalan. */
  let { form }: PageProps = $props();

  const PANGGUNG: Partial<Record<Warna, string>> = {
    mawar: panggungMawar,
    daun: panggungDaun,
    ungu: panggungUngu,
    biru: panggungBiru,
  };

  const lokal = ambilLokal();
  const daftar = new DaftarUrusan();
  daftar.onjudul = (id, judul) => lokal.ubahJudul(id, judul);
  daftar.onbaru = (baru) => lokal.gabungUrusan(baru);
  daftar.onhilang = (ids) => lokal.buangUrusan(ids);
  // Akun yang masuk: urusan akun ikut dari server (daftar tetap utuh setelah keluar lalu masuk lagi).
  const milik = $derived(Boolean(page.data.akun));
  // Muat ulang status hanya bila daftar id berubah (bukan saat judul di perangkat diperbarui).
  const idsLokal = $derived(lokal.data.urusan.map((u) => u.id).join(','));
  // svelte-ignore state_referenced_locally
  let pesan = $state(form?.pesan ?? '');
  let mengirim = $state(false);
  let bisaDikte = $state(false);
  let mendikte = $state(false);
  let hentikanDikte: (() => void) | undefined;
  let kotakPesan = $state<HTMLTextAreaElement>();

  // Lampiran (klip atau tempel foto) sama dengan komposer urusan: ubin kecil bernomor, dikirim bersama pesan
  // pertama oleh halaman urusan (titipan memori, lihat titipkanPesanAwal).
  let lampiran = $state<Lampiran[]>([]);
  let galatLampiran = $state<string | null>(null);
  let inputBerkas = $state<HTMLInputElement>();
  const TEKS_LAMPIRAN_SAJA = 'Tolong periksa foto yang saya lampirkan.';

  async function tambahLampiran(berkas: File[]) {
    const { baru, galat } = await buatLampiran(berkas, lampiran.length);
    galatLampiran = galat;
    if (baru.length) lampiran = [...lampiran, ...baru];
  }

  function hapusLampiran(kunci: string) {
    const l = lampiran.find((x) => x.kunci === kunci);
    if (l?.pratinjau) URL.revokeObjectURL(l.pratinjau);
    lampiran = lampiran.filter((x) => x.kunci !== kunci);
    galatLampiran = null;
    kotakPesan?.focus();
  }

  /** Ctrl+V foto/tangkapan layar: jadi lampiran; teks yang ikut ditempel tetap masuk kotak. */
  function tempel(e: ClipboardEvent) {
    const berkas = [...(e.clipboardData?.files ?? [])];
    if (!berkas.length) return;
    if (!e.clipboardData?.types.includes('text/plain')) e.preventDefault();
    void tambahLampiran(berkas);
  }

  // Sama dengan komposer urusan: Enter = kirim, Shift+Enter = baris baru (layar sentuh: Enter = baris baru).
  function tekan(e: KeyboardEvent) {
    if (mengirim || aksiEnter(e, matchMedia('(pointer: coarse)').matches) !== 'kirim') return;
    e.preventDefault();
    (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  afterNavigate(({ to }) => {
    if (!to?.url.searchParams.has('baru')) return;
    hentikanDikte?.();
    pesan = '';
    void tick().then(() => kotakPesan?.focus());
  });

  const wilayah = $derived(lokal.data.wilayah);
  // Urusan yang menunggu warga tampil paling depan dan jadi kartu utama (App 01: "Tinjau rencana").
  const menungguWarga = (u: (typeof daftar.isi)[number]) =>
    !!u.ringkasan && /MENUNGGU|RENCANA_DIUSULKAN/.test(u.ringkasan.state);
  const berjalan = $derived(
    [...daftar.isi].sort((a, b) => Number(menungguWarga(b)) - Number(menungguWarga(a))).slice(0, 3),
  );
  const utamaId = $derived(berjalan.find(menungguWarga)?.id);

  $effect(() => {
    // Modul dikte dimuat saat tombol Bicara ditekan supaya JS awal Beranda tetap di bawah anggaran.
    bisaDikte = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    void idsLokal;
    const m = milik;
    untrack(() => void daftar.muat(lokal.data.urusan, { milik: m }));
  });

  async function bicara() {
    if (mendikte) {
      hentikanDikte?.();
      return;
    }
    mendikte = true;
    const { mulaiDikte } = await import('#lib/suara.js');
    hentikanDikte = mulaiDikte(
      (t) => (pesan = t),
      () => (mendikte = false),
    );
  }
</script>

<svelte:head>
  <title>Urusin: urus layanan publik bersama</title>
</svelte:head>

<div
  class="relative isolate flex flex-1 flex-col gap-12 overflow-x-clip px-4 pt-10 pb-10 sm:px-8 lg:px-16 lg:pt-[68px] lg:pb-12"
>
  <div
    class="latar-beranda pointer-events-none absolute top-0 left-0 -z-10 hidden h-[660px] w-full lg:block dark:hidden"
    style:--pola="url({polaHero})"
    aria-hidden="true"
  ></div>
  <div
    class="riak-beranda pointer-events-none absolute top-0 left-0 -z-10 hidden h-[660px] w-full overflow-hidden"
    style:--pola="url({polaHero})"
    aria-hidden="true"
  ></div>

  <section aria-labelledby="judul-beranda" class="flex w-full flex-col items-center gap-5 text-center">
    <h1
      id="judul-beranda"
      class="text-[32px] leading-[1.1] font-medium tracking-[-1.3px] text-ink sm:text-[40px] sm:leading-[44px]"
    >
      Apa yang ingin Anda urus?
    </h1>
    <p class="w-full max-w-[640px] text-base text-body sm:text-[17px] sm:leading-[25px]">
      Ceritakan dengan bahasa sehari-hari. Urusin mencari aturan resmi sesuai wilayah KTP Anda, lalu menyusun
      langkahnya.
    </p>

    <form
      method="POST"
      action="?/mulai"
      class="flex w-full max-w-[760px] flex-col gap-3.5 rounded-[22px] border border-line-2 bg-surface pt-[18px] pr-[18px] pb-3.5 pl-[22px] text-left shadow-[0_10px_30px_#2525220d,0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a]"
      use:enhance={({ formData }) => {
        mengirim = true;
        if (lampiran.length) {
          const teks = pesan.trim() || TEKS_LAMPIRAN_SAJA;
          formData.set('pesan', teks);
          formData.set('lampiran', '1');
          titipkanPesanAwal(teks, lampiran);
          lampiran = [];
        } else lokal.simpanTertunda(pesan);
        return async ({ update }) => {
          await update({ reset: false });
          mengirim = false;
        };
      }}
    >
      <label for="pesan" class="sr-only">Ceritakan urusan Anda</label>
      <textarea
        id="pesan"
        name="pesan"
        rows="1"
        maxlength="2000"
        required={lampiran.length === 0}
        bind:value={pesan}
        bind:this={kotakPesan}
        onkeydown={tekan}
        onpaste={tempel}
        enterkeyhint="send"
        aria-describedby={form?.pesanWarga ? 'galat-pesan' : undefined}
        placeholder="Contoh: Anak saya baru lahir, saya harus mengurus apa?"
        class="block max-h-60 min-h-[26px] w-full resize-none bg-transparent text-[18px] leading-[26px] text-ink [field-sizing:content] placeholder:text-muted focus:outline-none"
      ></textarea>
      {#if wilayah}
        <input type="hidden" name="kodeKabKota" value={wilayah.kodeKabKota} />
      {/if}
      {#if form?.pesanWarga}
        <p id="galat-pesan" role="alert" class="text-sm font-medium text-galat">{form.pesanWarga}</p>
      {/if}
      {#if lampiran.length}
        <div class="flex flex-col gap-1.5 pt-1">
          <LampiranKecil {lampiran} onhapus={hapusLampiran} />
          <p class="text-xs text-muted">Foto dibaca AI dan disimpan terenkripsi di Dokumen Anda.</p>
        </div>
      {/if}
      {#if galatLampiran}
        <p role="alert" class="text-sm font-medium text-galat">{galatLampiran}</p>
      {/if}
      <input
        bind:this={inputBerkas}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        onchange={(e) => {
          const input = e.currentTarget;
          void tambahLampiran([...(input.files ?? [])]);
          input.value = '';
        }}
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
      />
      <!-- Satu baris di semua layar: klip di kiri; mikrofon lalu Kirim di kanan, semuanya tombol ikon bulat
           (label tetap terbaca pembaca layar), sama dengan komposer urusan. Wilayah ditanyakan di percakapan
           atau diatur di Pengaturan. -->
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          onclick={() => inputBerkas?.click()}
          disabled={lampiran.length >= LAMPIRAN_MAKS}
          class="grid size-10 shrink-0 place-items-center rounded-full bg-bg-2 text-ink hover:bg-line-3 disabled:opacity-50"
        >
          <Icon name="klip" class="size-4" label="Lampirkan foto atau PDF" />
        </button>
        <div class="flex items-center gap-2">
          {#if bisaDikte}
            <button
              type="button"
              onclick={bicara}
              aria-pressed={mendikte}
              aria-label={mendikte ? 'Berhenti mendengarkan' : 'Bicara'}
              class="grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-line-3 {mendikte
                ? 'bg-line-3 ring-2 ring-brand'
                : 'bg-bg-2'}"
            >
              <Icon name="mikrofon" class="size-4" />
            </button>
          {/if}
          <button
            type="submit"
            disabled={mengirim}
            aria-busy={mengirim || undefined}
            class="grid size-10 shrink-0 place-items-center rounded-full bg-primer text-primer-ink disabled:opacity-80"
          >
            <Icon
              name={mengirim ? 'memuat' : 'panah-atas'}
              class="size-[18px] {mengirim ? 'animate-spin' : ''}"
              label="Kirim"
            />
          </button>
        </div>
      </div>
    </form>
  </section>

  <section aria-labelledby="judul-peristiwa" class="flex w-full flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 id="judul-peristiwa" class="text-[20px] leading-[29px] font-semibold tracking-[-0.3px] text-ink">
        Atau mulai dari peristiwa hidup
      </h2>
    </div>
    <ul class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {#each PERISTIWA as p (p.slug)}
        <li class="min-w-0">
          <a
            href={resolve('/peristiwa/[slug]', { slug: p.slug })}
            class="kartu-peristiwa group flex h-full flex-col rounded-[20px] bg-card"
          >
            <span
              class="panggung panggung-{p.warna} relative isolate block h-[140px] w-full overflow-hidden rounded-[20px]"
              style:--panggung="url({PANGGUNG[p.warna]})"
            >
              <img
                src={p.gambar}
                alt=""
                width="118"
                height="128"
                class="absolute top-3 left-1/2 h-32 w-[118px] -translate-x-1/2 object-contain"
              />
            </span>
            <span class="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
              <span
                class="flex items-center justify-between gap-2 text-[18px] leading-[26px] font-semibold text-ink"
              >
                {p.judul}
                <Icon name="panah" class="size-[18px] shrink-0" />
              </span>
              <span class="text-[15px] leading-[21px] text-muted">{p.ringkas}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  {#if berjalan.length || daftar.galat}
    <section aria-labelledby="judul-berjalan" class="flex w-full flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-x-4">
        <h2 id="judul-berjalan" class="text-[20px] leading-[29px] font-semibold tracking-[-0.3px] text-ink">
          Urusan berjalan
        </h2>
        <a
          href={resolve('/urusanku')}
          class="-my-2 inline-flex items-center gap-1 py-2 text-[15px] font-semibold text-ink hover:underline"
        >
          Lihat semua di Urusanku <Icon name="panah" class="size-4" />
        </a>
      </div>
      {#if daftar.galat}
        <div
          role="alert"
          class="flex flex-wrap items-center gap-3 rounded-xl bg-kuning px-4 py-3 text-sm text-kuning-ink"
        >
          <p class="min-w-0 flex-1">Status terbaru belum bisa dimuat. Periksa koneksi, lalu coba lagi.</p>
          <button
            type="button"
            disabled={daftar.memuat}
            onclick={() => void daftar.muat(lokal.data.urusan, { milik })}
            class="min-h-12 rounded-full border border-current px-4 font-semibold disabled:opacity-60"
            >Coba lagi</button
          >
        </div>
      {/if}
      <div class="flex flex-col gap-3 md:flex-row">
        {#each berjalan as u (u.id)}
          <KartuBerjalan
            urusan={{ ...u, judul: lokal.cari(u.id)?.judul ?? u.judul }}
            utama={u.id === utamaId}
            memuat={daftar.memuat}
          />
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  /*
   * Panggung kartu peristiwa: gambar gradasi bertitik dari pen mulai 640 px; di ponsel gradasi CSS dengan
   * warna yang sama (lebih ringan, dan gambar panggung tidak jadi elemen LCP).
   */
  .panggung-mawar {
    background: linear-gradient(#f3e3e2, #fcf8f5);
  }
  .panggung-daun {
    background: linear-gradient(#eaede5, #fcf8f5);
  }
  .panggung-ungu {
    background: linear-gradient(#f1e9f2, #fcf8f5);
  }
  .panggung-biru {
    background: linear-gradient(#e6eef4, #fcf8f5);
  }
  @media (min-width: 640px) {
    .panggung {
      background: var(--panggung) center / 100% 100% no-repeat;
    }
  }
  :global([data-theme='dark']) .panggung {
    background: var(--color-bg-2);
  }

  /*
   * Salinan 1:1 pola + gelombang hero landing (.lp2 + .n-hero-gelombang di landing-pen.css dan
   * landing-gerak.css): kotak 660 px selebar panel, gambar cover di atas tengah, pudar 18%/82% dan 50%,
   * cincin 2200 px dari tengah bawah. Ubah di sana, ubah juga di sini (keputusan pemilik 2026-11-14).
   */
  @media (min-width: 1024px) {
    .latar-beranda {
      background: var(--pola) top center / cover no-repeat;
      mask-image:
        linear-gradient(to right, transparent, #000 18%, #000 82%, transparent),
        linear-gradient(#000 50%, transparent);
      mask-composite: intersect;
    }
  }
  @media (min-width: 1024px) and (prefers-reduced-motion: no-preference) {
    .riak-beranda {
      display: block;
      mask:
        var(--pola) top center / cover no-repeat,
        linear-gradient(to right, transparent, #000 18%, #000 82%, transparent),
        linear-gradient(#000 50%, transparent);
      mask-composite: intersect;
    }
    :global([data-theme='dark']) .riak-beranda {
      display: none;
    }
    .riak-beranda::before,
    .riak-beranda::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 100%;
      width: 2200px;
      height: 2200px;
      margin: -1100px 0 0 -1100px;
      border-radius: 50%;
      background: radial-gradient(closest-side, #25252200 58%, #252522 80%, #25252200);
      opacity: 0;
      animation: riak 7s cubic-bezier(0.25, 0.1, 0.5, 1) 1.2s infinite;
    }
    .riak-beranda::after {
      animation-delay: 4.7s;
    }
  }
  @keyframes riak {
    0% {
      opacity: 0;
      transform: scale(0.05);
    }
    10% {
      opacity: 1;
    }
    60% {
      opacity: 0.9;
    }
    90%,
    100% {
      opacity: 0;
      transform: scale(0.85);
    }
  }

  /* Kartu peristiwa persis kartu layanan landing (lp108/lp109): bingkai krem tanpa garis, panggung
     membulat dengan bayangan tipis yang sama (keputusan pemilik 2026-11-14). */
  .kartu-peristiwa .panggung {
    box-shadow:
      0 0 1px #0000000f,
      0 1px 1px #0000000f,
      0 2px 4px #0000000a;
  }
  .kartu-peristiwa {
    transition: background-color 0.2s ease;
  }
  @media (hover: hover) {
    .kartu-peristiwa:hover {
      background-color: var(--color-bg-2);
    }
  }
</style>
