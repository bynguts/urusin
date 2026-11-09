<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, formAuth, galatAuth } from '#lib/components/auth/form.js';

  /**
   * App 17 Verifikasi email. Tautan email membawa `?token=`; token dipakai saat tombol ditekan (`?/pastikan`,
   * bersama kata sandi yang dibuat saat mendaftar), bukan saat halaman dibuka. Tanpa token / token kedaluwarsa: formulir kirim ulang (`?/kirimUlang`).
   */
  const data = $derived(dataAuth<{ token: string; tokenBerlaku: boolean }>());
  const form = $derived(formAuth());
  const galat = $derived(galatAuth());
  const token = $derived(data.token ?? '');
  const bisaPastikan = $derived(
    token !== '' && data.tokenBerlaku !== false && galat?.kode !== 'TOKEN_TIDAK_VALID',
  );
  let sibuk = $state(false);

  const kirimEnhance = () => {
    sibuk = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      sibuk = false;
    };
  };
</script>

<svelte:head><title>Pastikan email · Urusin</title></svelte:head>

<KerangkaAuth judul="Satu langkah lagi" sub="Kami perlu memastikan email ini milik Anda.">
  <span class="grid size-14 place-items-center rounded-2xl bg-bg-2"><Icon name="surel" class="size-6" /></span
  >

  {#if form?.terverifikasi}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">
      Email sudah dipastikan
    </h1>
    <p role="status" class="mt-3 text-[1.0625rem] leading-[25px] text-body">
      Email sudah dipastikan. Silakan masuk lagi; akun Anda kini sama di semua perangkat.
    </p>
    <a
      href={resolve('/masuk')}
      class="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90"
      >Masuk <Icon name="panah" class="size-4.5" /></a
    >
  {:else if form?.terkirim}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">Cek email Anda</h1>
    <p role="status" class="mt-3 text-[1.0625rem] leading-[25px] text-body">
      Cek email Anda: bila <span class="font-semibold text-ink">{form.email}</span> terdaftar dan belum dipastikan,
      tautan baru sudah dikirim. Tautan berlaku 24 jam.
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
  {:else if bisaPastikan}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">
      Pastikan email Anda
    </h1>
    <p class="mt-3 text-[1.0625rem] leading-[25px] text-body">
      Masukkan kata sandi yang Anda buat saat mendaftar, lalu tekan tombol di bawah.
    </p>
    {#if galat}
      <p
        role="alert"
        data-kode={galat.kode}
        class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        {galat.pesanWarga}
      </p>
    {/if}
    <form method="POST" action="?/pastikan" use:enhance={kirimEnhance} class="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div class="flex flex-col gap-2">
        <label for="sandi" class="text-[0.9375rem] font-semibold text-ink"
          >Kata sandi yang Anda buat saat mendaftar</label
        >
        <InputSandi id="sandi" autocomplete="current-password" invalid={galat?.kode === 'KREDENSIAL_SALAH'} />
      </div>
      <button
        type="submit"
        disabled={sibuk}
        class="flex min-h-14 w-full items-center justify-center rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
        >Pastikan email saya</button
      >
    </form>
  {:else}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">
      {token ? 'Tautan sudah tidak berlaku' : 'Kirim tautan pemastian'}
    </h1>
    {#if galat}
      <p
        role="alert"
        data-kode={galat.kode}
        class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        {galat.pesanWarga}
      </p>
    {:else if token}
      <p
        role="alert"
        data-kode="TOKEN_TIDAK_VALID"
        class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.
      </p>
    {/if}
    <p class="mt-3 text-[1.0625rem] leading-[25px] text-body">
      {token
        ? 'Tautan ini sudah dipakai atau kedaluwarsa. Tulis email Anda untuk meminta tautan baru.'
        : 'Belum menerima tautan? Tulis email yang Anda pakai saat mendaftar.'}
    </p>
    <form method="POST" action="?/kirimUlang" use:enhance={kirimEnhance} class="mt-5 flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <label for="email" class="text-[0.9375rem] font-semibold text-ink">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          required
          defaultValue={form?.email ?? ''}
          class="h-14 w-full rounded-[14px] border border-line-2 bg-surface px-4 text-[1.125rem] text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={sibuk}
        class="flex min-h-14 w-full items-center justify-center rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
        >Kirim ulang tautan</button
      >
    </form>
  {/if}

  <p class="mt-5 text-[0.9375rem] text-body">
    <a href={resolve('/masuk')} class="inline-flex min-h-12 items-center font-semibold text-ink"
      >Kembali ke Masuk</a
    >
  </p>
</KerangkaAuth>
