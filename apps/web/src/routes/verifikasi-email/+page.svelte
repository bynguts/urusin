<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 17 (Verifikasi email). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Pastikan email · Urusin</title></svelte:head>

<main>
  <h1>Pastikan email</h1>
  {#if form && 'terverifikasi' in form}
    <p role="status">Email sudah dipastikan. Silakan masuk lagi; akun Anda kini sama di semua perangkat.</p>
    <p><a href={resolve('/masuk')}>Masuk</a></p>
  {:else if form && 'terkirim' in form}
    <p role="status">Bila email {form.email} terdaftar dan belum dipastikan, tautan baru sudah kami kirim.</p>
    {#if form.tertunda}
      <p role="alert" data-kode="EMAIL_TERTUNDA">
        Pengiriman email sedang tertunda (layanan email kami sedang penuh). Akun tetap bisa dipakai di
        perangkat ini seperti tamu; coba kirim ulang tautan nanti.
      </p>
    {/if}
  {:else}
    {#if form && 'kode' in form}
      <p role="alert" data-kode={form.kode}>{form.pesanWarga}</p>
    {/if}
    {#if data.tokenBerlaku}
      <form method="POST" action="?/pastikan">
        <input type="hidden" name="token" value={data.token} />
        <label for="sandi">Kata sandi yang Anda buat saat mendaftar</label>
        <input id="sandi" name="sandi" type="password" autocomplete="current-password" required />
        <button type="submit">Pastikan email saya</button>
      </form>
    {:else}
      {#if data.token}
        <p role="alert" data-kode="TOKEN_TIDAK_VALID">
          Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.
        </p>
      {/if}
      <form method="POST" action="?/kirimUlang">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <button type="submit">Kirim ulang tautan</button>
      </form>
    {/if}
  {/if}
</main>
