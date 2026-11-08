<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 15 (Masuk). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const galat = $derived(form ?? data.galat);
</script>

<svelte:head><title>Masuk · Urusin</title></svelte:head>

<main>
  <h1>Masuk</h1>
  {#if galat}
    <p role="alert" data-kode={galat.kode}>{galat.pesanWarga}</p>
    {#if galat.kode === 'EMAIL_BELUM_TERVERIFIKASI'}
      <p><a href={resolve('/verifikasi-email')}>Kirim ulang tautan</a></p>
    {/if}
  {/if}
  <form method="POST">
    <input type="hidden" name="next" value={data.next} />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
    <label for="sandi">Kata sandi</label>
    <input id="sandi" name="sandi" type="password" autocomplete="current-password" required />
    <button type="submit">Masuk</button>
  </form>
  {#if data.googleAktif}
    <form method="GET" action="/auth/google" data-sveltekit-reload>
      <input type="hidden" name="next" value={data.next} />
      <button type="submit">Masuk dengan Google</button>
    </form>
  {/if}
  <p><a href={resolve('/lupa-sandi')}>Lupa kata sandi?</a></p>
  <p><a href={resolve('/daftar')}>Belum punya akun? Daftar</a></p>
  <p><a href={resolve('/')}>Coba tanpa daftar</a></p>
</main>
