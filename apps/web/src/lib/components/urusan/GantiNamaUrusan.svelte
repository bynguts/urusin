<script lang="ts">
  import Icon from '../Icon.svelte';
  import Field from '../ui/Field.svelte';
  import { gantiJudul } from '#lib/judul-urusan.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';

  /**
   * Dialog "Ganti nama" urusan (sidebar, Urusanku). Nama warga disimpan di server dan menang atas judul AI;
   * catatan perangkat ikut diperbarui sehingga sidebar langsung berubah.
   */
  let { ontersimpan }: { ontersimpan?: (id: string, judul: string) => void } = $props();

  const lokal = ambilLokal();
  // Sidebar dan Urusanku masing-masing punya dialog ini: id unik per instans.
  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let id = $state('');
  let nama = $state('');
  let galat = $state('');
  let menyimpan = $state(false);

  export function buka(urusanId: string, judulKini: string) {
    id = urusanId;
    nama = judulKini;
    galat = '';
    dialog?.showModal();
    queueMicrotask(() => input?.select());
  }

  async function simpan(e: SubmitEvent) {
    e.preventDefault();
    const t = nama.trim();
    if (!t) return void (galat = 'Tulis nama urusan.');
    menyimpan = true;
    const r = await gantiJudul(id, t);
    menyimpan = false;
    if (!r.ok) return void (galat = r.pesan);
    lokal.ubahJudul(id, r.judul);
    ontersimpan?.(id, r.judul);
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="{uid}-judul"
  class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-kartu bg-surface p-0 text-ink shadow-lembut backdrop:bg-ink/40"
>
  <form onsubmit={simpan} class="flex flex-col gap-4 p-5 sm:p-6">
    <h2 id="{uid}-judul" class="text-xl font-semibold">Ganti nama urusan</h2>
    <Field
      id="{uid}-nama"
      label="Nama urusan"
      petunjuk="Nama ini hanya terlihat oleh Anda. Hindari NIK atau nomor HP."
      galat={galat || undefined}
    >
      {#snippet children({ describedby, invalid })}
        <input
          id="{uid}-nama"
          bind:this={input}
          bind:value={nama}
          maxlength="60"
          autocomplete="off"
          aria-describedby={describedby}
          aria-invalid={invalid}
          class="h-12 rounded-xl border border-line-2 bg-surface px-3 text-base"
        />
      {/snippet}
    </Field>
    <div class="mt-1 flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onclick={() => dialog?.close()}
        class="inline-flex min-h-12 items-center rounded-full border border-line-2 px-5 font-semibold hover:bg-card"
        >Batal</button
      >
      <button
        type="submit"
        disabled={menyimpan}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink disabled:opacity-60"
      >
        {#if menyimpan}<Icon name="memuat" class="size-4.5 animate-spin" />{/if}
        Simpan
      </button>
    </div>
  </form>
</dialog>
