<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import Chip from '../ui/Chip.svelte';

  /**
   * Bagian Anda (★7): login, CAPTCHA, profil, atau tombol kirim akhir dikerjakan warga sendiri. Urusin menunggu
   * lalu melanjutkan dari langkah ini.
   */
  let { gate, aktif, onlanjut }: { gate: EventOf<'gate'>; aktif: boolean; onlanjut: () => void } = $props();

  const JUDUL: Record<EventOf<'gate'>['jenis'], string> = {
    konfirmasi: 'Persetujuan Anda diperlukan',
    login: 'Masuk akun di situs resmi',
    captcha: 'Selesaikan pemeriksaan keamanan situs',
    profil: 'Lengkapi data diri',
    final: 'Periksa isian, lalu kirim sendiri',
  };
</script>

<section aria-label="Giliran Anda" class="overflow-hidden rounded-2xl border border-kuning bg-surface">
  <div class="flex gap-3 bg-kuning/60 px-4 py-3.5 sm:px-5">
    <span class="grid size-8 shrink-0 place-items-center rounded-full bg-kuning text-kuning-ink">
      <Icon name="tangan" class="size-4.5" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-base font-semibold text-ink">{JUDUL[gate.jenis]}</h3>
        <Chip nada="anda" ikon="tangan">Giliran Anda</Chip>
      </div>
      <p class="mt-1 text-[0.9375rem] text-body">{gate.pesan}</p>
      {#if gate.jenis === 'login' || gate.jenis === 'captcha'}
        <p class="mt-1 text-sm text-muted">Yang Anda ketik tidak dibaca AI dan tidak dicatat.</p>
      {:else if gate.jenis === 'final'}
        <p class="mt-1 text-sm text-muted">AI dikunci agar tidak bisa mengirim.</p>
      {/if}
    </div>
  </div>
  {#if aktif}
    <div class="px-4 py-3 sm:px-5">
      <button
        type="button"
        onclick={onlanjut}
        class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 text-base font-medium text-ink hover:bg-card"
      >
        Sudah, lanjutkan dari langkah ini <Icon name="panah" class="size-4.5" />
      </button>
    </div>
  {/if}
</section>
