<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, formAuth, galatAuth } from '#lib/components/auth/form.js';

  /** App 16 Daftar. Sukses selalu "Cek email Anda" (server tidak membocorkan apakah email sudah terdaftar). */
  const data = $derived(dataAuth<{ googleAktif: boolean }>());
  const form = $derived(formAuth());
  const galat = $derived(galatAuth());
  const sandiDitolak = $derived(galat?.kode.startsWith('SANDI_') ?? false);
  let sibuk = $state(false);
</script>

<svelte:head><title>Daftar · Urusin</title></svelte:head>

<KerangkaAuth
  judul="Satu akun untuk semua urusan keluarga"
  sub="Gratis. Data keluarga disimpan terenkripsi di brankas Urusin."
>
  {#if form?.terkirim}
    <span class="grid size-14 place-items-center rounded-2xl bg-bg-2"
      ><Icon name="surel" class="size-6" /></span
    >
    <h1 class="mt-5 text-[1.875rem] tracking-[-0.03em] text-ink">Cek email Anda</h1>
    <p role="status" class="mt-3 text-base text-body">
      Cek email Anda: kami mengirim tautan ke <span class="font-semibold text-ink">{form.email}</span>. Tautan
      berlaku 24 jam. Buka tautan itu dan masukkan kata sandi yang baru Anda buat.
    </p>
    {#if form.tertunda}
      <p
        role="alert"
        data-kode="EMAIL_TERTUNDA"
        class="mt-3 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        Pengiriman email sedang tertunda (layanan email kami sedang penuh atau belum aktif). Akun tetap bisa
        dipakai di perangkat ini; coba kirim ulang tautan nanti.
      </p>
    {/if}
    <p class="mt-3 text-sm text-muted">Cek juga folder Spam atau Promosi.</p>
    <a
      href={resolve('/masuk')}
      class="mt-6 flex min-h-14 w-full items-center justify-center rounded-full border border-line-2 font-semibold text-ink hover:bg-card"
      >Ke halaman Masuk</a
    >
  {:else}
    <h1 class="text-[1.875rem] tracking-[-0.03em] text-ink">Buat akun Urusin</h1>

    {#if galat && !sandiDitolak}
      <p
        role="alert"
        data-kode={galat.kode}
        class="mt-5 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        {galat.pesanWarga}
      </p>
    {/if}

    {#if data.googleAktif}
      <form method="GET" action="/auth/google" data-sveltekit-reload class="mt-6">
        <input type="hidden" name="next" value="/" />
        <button
          type="submit"
          class="flex min-h-14 w-full items-center justify-center rounded-full border border-line-2 bg-surface font-semibold text-ink hover:bg-card"
          >Daftar dengan Google</button
        >
      </form>
      <p class="my-5 flex items-center gap-3 text-sm text-muted">
        <span class="h-px flex-1 bg-line"></span>atau pakai email<span class="h-px flex-1 bg-line"></span>
      </p>
    {/if}

    <form
      method="POST"
      class="flex flex-col gap-4 {data.googleAktif ? '' : 'mt-6'}"
      use:enhance={() => {
        sibuk = true;
        return async ({ update }) => {
          await update({ reset: false });
          sibuk = false;
        };
      }}
    >
      <div class="flex flex-col gap-2">
        <label for="email" class="text-[0.9375rem] font-semibold text-ink">Email</label>
        <div class="relative">
          <Icon
            name="surel"
            class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          />
          <input
            id="email"
            name="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            required
            defaultValue={form?.email ?? ''}
            class="h-14 w-full rounded-2xl border border-line-2 bg-surface pr-4 pl-12 text-base text-ink"
          />
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <label for="sandi" class="text-[0.9375rem] font-semibold text-ink">Kata sandi</label>
        <InputSandi
          id="sandi"
          autocomplete="new-password"
          describedby={sandiDitolak ? 'sandi-petunjuk sandi-galat' : 'sandi-petunjuk'}
          invalid={sandiDitolak}
        />
        <p id="sandi-petunjuk" class="text-sm text-muted">
          Minimal 10 karakter dan bukan sandi yang umum dipakai.
        </p>
        {#if galat && sandiDitolak}
          <p id="sandi-galat" role="alert" data-kode={galat.kode} class="text-sm font-medium text-galat">
            {galat.pesanWarga}
          </p>
        {/if}
      </div>
      <p class="text-sm text-body">
        Dengan mendaftar, Anda setuju dengan Syarat layanan dan
        <a href={resolve('/privasi')} class="font-semibold text-ink underline">Kebijakan privasi</a> Urusin.
      </p>
      <button
        type="submit"
        disabled={sibuk}
        class="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
      >
        Daftar <Icon name="panah" class="size-4.5" />
      </button>
    </form>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[0.9375rem] text-body">
      <p>
        Sudah punya akun? <a
          href={resolve('/masuk')}
          class="inline-flex min-h-12 items-center font-semibold text-ink">Masuk</a
        >
      </p>
      <a href={resolve('/beranda')} class="inline-flex min-h-12 items-center font-semibold text-ink underline"
        >Coba tanpa daftar</a
      >
    </div>
  {/if}
</KerangkaAuth>
