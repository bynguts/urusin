<script lang="ts">
  import { resolve } from '$app/paths';

  /** Segmen Berkas / Data diri (App 11–12: wadah 4 px r14, tab 40 px r10). Dua rute terpisah, jadi berupa tautan dengan aria-current. */
  let { aktif }: { aktif: 'berkas' | 'data-diri' } = $props();
  const TAB = [
    { id: 'berkas', label: 'Berkas' },
    { id: 'data-diri', label: 'Data diri' },
  ] as const;
</script>

<nav aria-label="Brankas" class="inline-flex gap-1 rounded-[14px] bg-bg-2 p-1">
  {#each TAB as t (t.id)}
    <a
      href={t.id === 'berkas' ? resolve('/dokumen') : resolve('/data-diri')}
      aria-current={aktif === t.id ? 'page' : undefined}
      class="inline-flex h-10 items-center rounded-[10px] px-5 text-[15px] transition-all duration-150 active:scale-95 {aktif === t.id
        ? 'bg-surface font-semibold text-ink shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
        : 'text-card-ink hover:bg-card'}">{t.label}</a
    >
  {/each}
</nav>
