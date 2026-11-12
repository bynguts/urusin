<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../Icon.svelte';

  /**
   * Menu titik tiga satu urusan (sidebar Urusan aktif, kartu Urusanku): saat ini satu aksi, "Ganti nama".
   * Klik kanan pada baris urusan membuka menu yang sama lewat `buka()`. Esc atau klik di luar menutupnya.
   */
  let {
    label,
    onganti,
    class: kelas = '',
  }: { label: string; onganti: () => void; class?: string } = $props();

  let terbuka = $state(false);
  let wadah = $state<HTMLDivElement>();
  let tombol = $state<HTMLButtonElement>();

  export async function buka() {
    terbuka = true;
    await tick();
    wadah?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }

  function tutup(kembali = false) {
    terbuka = false;
    if (kembali) tombol?.focus();
  }

  function pilihGanti() {
    tutup();
    onganti();
  }
</script>

<svelte:window
  onclick={(e) => {
    if (terbuka && wadah && !wadah.contains(e.target as Node)) tutup();
  }}
/>

<div bind:this={wadah} class="relative shrink-0 {kelas}">
  <button
    bind:this={tombol}
    type="button"
    aria-label="Opsi urusan {label}"
    aria-haspopup="menu"
    aria-expanded={terbuka}
    onclick={() => (terbuka ? tutup() : void buka())}
    class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
  >
    <Icon name="opsi" class="size-[18px]" />
  </button>
  {#if terbuka}
    <div
      role="menu"
      tabindex="-1"
      aria-label="Opsi urusan {label}"
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          tutup(true);
        }
      }}
      class="absolute top-full right-0 z-30 mt-1 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-lembut"
    >
      <button
        type="button"
        role="menuitem"
        onclick={pilihGanti}
        class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[15px] text-ink hover:bg-card"
      >
        <Icon name="pensil" class="size-4" /> Ganti nama
      </button>
    </div>
  {/if}
</div>
