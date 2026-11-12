<script lang="ts">
  import { enhance } from '$app/forms';
  import Icon from '#lib/components/Icon.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, galatAuth } from '#lib/components/auth/form.js';
  import { namaPendek } from '#lib/stores/lokal.svelte.js';

  /** App 20 Lengkapi profil: satu pertanyaan utama (nama sesuai KTP), HP opsional. */
  const data = $derived(dataAuth<{ next: string; namaLengkap: string }>());
  const galat = $derived(galatAuth());
  const sapaan = $derived(data.namaLengkap ? `Halo, ${namaPendek(data.namaLengkap)}!` : 'Halo!');
  let sibuk = $state(false);
</script>

<svelte:head><title>Lengkapi profil · Urusin</title></svelte:head>

<KerangkaAuth judul={sapaan} sub="Lengkapi nama yang ingin Anda simpan dalam profil akun.">
  <h1 class="text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">Lengkapi profil</h1>
  <p class="mt-2 text-[1.0625rem] leading-[25px] text-body">Bisa diubah kapan saja di Dokumen › Data diri.</p>
  {#if galat}
    <p
      role="alert"
      data-kode={galat.kode}
      class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
    >
      {galat.pesanWarga}
    </p>
  {/if}
  <form
    method="POST"
    class="mt-6 flex flex-col gap-4"
    use:enhance={() => {
      sibuk = true;
      return async ({ update }) => {
        await update({ reset: false });
        sibuk = false;
      };
    }}
  >
    <input type="hidden" name="next" value={data.next ?? '/'} />
    <div class="flex flex-col gap-2">
      <label for="namaLengkap" class="text-[0.9375rem] font-semibold text-ink">Nama lengkap</label>
      <div class="relative">
        <Icon
          name="orang"
          class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
        />
        <input
          id="namaLengkap"
          name="namaLengkap"
          autocomplete="name"
          required
          maxlength="200"
          defaultValue={data.namaLengkap ?? ''}
          aria-describedby="nama-petunjuk"
          class="h-14 w-full rounded-[14px] border border-line-2 bg-surface pr-4 pl-12 text-[1.125rem] text-ink"
        />
      </div>
      <p id="nama-petunjuk" class="text-sm text-muted">Tulis persis seperti di KTP.</p>
    </div>
    <div class="flex flex-col gap-2">
      <label for="hp" class="text-[0.9375rem] font-semibold text-ink"
        >Nomor HP <span class="font-normal text-muted">(boleh dikosongkan)</span></label
      >
      <input
        id="hp"
        name="hp"
        type="tel"
        inputmode="numeric"
        autocomplete="tel"
        aria-describedby="hp-petunjuk"
        class="h-14 w-full rounded-[14px] border border-line-2 bg-surface px-4 text-[1.125rem] text-ink"
      />
      <p id="hp-petunjuk" class="text-sm text-muted">
        Disimpan sebagai bagian dari profil Anda. Jangan menuliskannya dalam chat.
      </p>
    </div>
    <button
      type="submit"
      disabled={sibuk}
      class="mt-1 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink disabled:opacity-60"
    >
      Simpan dan mulai <Icon name="panah" class="size-4.5" />
    </button>
  </form>
</KerangkaAuth>
