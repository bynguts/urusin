<script lang="ts" module>
  import type { EventOf } from '#lib/contracts.js';

  type Format = EventOf<'berkas'>['format'];
  /** Label format untuk warga; ikon teks untuk dokumen, tabel/slide memakai ikon berkas umum. */
  export const FORMAT_BERKAS: Record<Format, { label: string; ikon: 'berkas-teks' | 'berkas' }> = {
    docx: { label: 'Word (DOCX)', ikon: 'berkas-teks' },
    pdf: { label: 'PDF', ikon: 'berkas-teks' },
    xlsx: { label: 'Excel (XLSX)', ikon: 'berkas' },
    pptx: { label: 'PowerPoint (PPTX)', ikon: 'berkas' },
  };
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { unduhDokumen, ukuranBerkas } from '#lib/akun/klien.js';
  import Icon from '../Icon.svelte';

  /**
   * Kartu berkas buatan agen (`berkas__buat`): nama, format, ukuran, dan tombol Unduh. Berkas diambil dari Dokumen
   * (GET /api/vault/[id], didekripsi di server); perangkat baru diminta masuk ulang dulu, sama dengan halaman Dokumen.
   */
  let { berkas }: { berkas: EventOf<'berkas'> } = $props();

  const f = $derived(FORMAT_BERKAS[berkas.format]);
  let sibuk = $state(false);
  let pesan = $state<string | null>(null);

  async function unduh() {
    sibuk = true;
    pesan = null;
    const r = await unduhDokumen(berkas.id);
    sibuk = false;
    if (!r.ok) {
      if (r.lanjut) {
        const masuk = `${resolve('/masuk')}?ulang=1&lanjut=${encodeURIComponent(r.lanjut)}`;
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- path lewat resolve(), hanya ditambah query
        return void (await goto(masuk));
      }
      pesan = r.pesan;
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = berkas.nama;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
</script>

<section
  data-berkas
  aria-label="Berkas siap diunduh"
  class="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] sm:p-[18px]"
>
  <div class="flex items-start gap-3">
    <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-bg-2 text-ink">
      <Icon name={f.ikon} class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-base leading-6 font-semibold break-words text-ink">{berkas.nama}</p>
      <p class="text-sm leading-[21px] text-muted">
        {f.label} · {ukuranBerkas(berkas.ukuran)} · tersimpan di
        <a href={resolve('/dokumen')} class="underline underline-offset-2">Dokumen</a>
      </p>
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-2.5">
    <button
      type="button"
      onclick={unduh}
      disabled={sibuk}
      aria-busy={sibuk || undefined}
      class="inline-flex h-12 items-center gap-2 rounded-full bg-primer px-5 text-base leading-6 font-semibold text-primer-ink disabled:opacity-60"
    >
      <Icon name="unduh" class="size-[18px]" />
      {sibuk ? 'Mengunduh…' : 'Unduh'}
    </button>
    <p class="text-sm leading-[21px] text-muted">Periksa isinya, lalu tanda tangani sendiri.</p>
  </div>
  {#if pesan}
    <p role="alert" class="text-sm font-medium text-galat">{pesan}</p>
  {/if}
</section>
