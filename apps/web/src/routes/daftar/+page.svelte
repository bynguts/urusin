<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 16 (Daftar). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Daftar · Urusin</title></svelte:head>

<main>
  <h1>Daftar</h1>
  {#if form && 'terkirim' in form}
    <p role="status">
      Cek email Anda. Kami mengirim tautan untuk memastikan email {form.email}. Buka tautannya dan masukkan
      kata sandi yang baru Anda buat.
    </p>
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
    <form method="POST">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
      <label for="sandi">Kata sandi (minimal 8 karakter)</label>
      <input id="sandi" name="sandi" type="password" autocomplete="new-password" minlength="8" required />
      <button type="submit">Daftar</button>
    </form>
    {#if data.googleAktif}
      <form method="GET" action="/auth/google" data-sveltekit-reload>
        <button type="submit">Daftar dengan Google</button>
      </form>
    {/if}
    <p><a href={resolve('/masuk')}>Sudah punya akun? Masuk</a></p>
  {/if}
</main>
