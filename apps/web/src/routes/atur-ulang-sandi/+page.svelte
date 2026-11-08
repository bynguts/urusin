<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 19 (Atur ulang kata sandi). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Atur ulang kata sandi · Urusin</title></svelte:head>

<main>
  <h1>Buat kata sandi baru</h1>
  {#if form && 'berhasil' in form}
    <p role="status">Kata sandi baru tersimpan. Semua perangkat sudah dikeluarkan. Silakan masuk lagi.</p>
    <p><a href={resolve('/masuk')}>Masuk</a></p>
  {:else if data.tokenBerlaku}
    {#if form && 'kode' in form}
      <p role="alert" data-kode={form.kode}>{form.pesanWarga}</p>
    {/if}
    <form method="POST">
      <input type="hidden" name="token" value={data.token} />
      <label for="sandi">Kata sandi baru (minimal 8 karakter)</label>
      <input id="sandi" name="sandi" type="password" autocomplete="new-password" minlength="8" required />
      <button type="submit">Simpan kata sandi</button>
    </form>
  {:else}
    <p role="alert" data-kode="TOKEN_TIDAK_VALID">
      Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.
    </p>
    <p><a href={resolve('/lupa-sandi')}>Minta tautan baru</a></p>
  {/if}
</main>
