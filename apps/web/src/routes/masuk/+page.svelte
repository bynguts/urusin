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
  {/if}
  {#if data.tautkan}
    <p role="status" data-tautkan>Masuk dengan kata sandi untuk menautkan akun Google Anda.</p>
  {/if}
  <form method="POST" action="?/masuk">
    <input type="hidden" name="next" value={data.next} />
    <!-- Rafi: widget Turnstile (site key `data.turnstileSiteKey`) mengisi `cf-turnstile-response`. -->
    <input type="hidden" name="turnstile" value="" />
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
  {#if data.juri}
    <form method="POST" action="?/juri" data-juri>
      <input type="hidden" name="turnstile" value="" />
      <button type="submit">Masuk sebagai juri</button>
    </form>
  {/if}
  <p><a href={resolve('/lupa-sandi')}>Lupa kata sandi?</a></p>
  <p><a href={resolve('/daftar')}>Belum punya akun? Daftar</a></p>
  <p><a href={resolve('/')}>Coba tanpa daftar</a></p>
</main>
