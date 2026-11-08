<script lang="ts">
  import { resolve } from '$app/paths';

  /** Segmen Berkas / Data diri (App 11–12). Dua rute terpisah, jadi berupa tautan dengan aria-current. */
  let { aktif }: { aktif: 'berkas' | 'data-diri' } = $props();
  const TAB = [
    { id: 'berkas', label: 'Berkas' },
    { id: 'data-diri', label: 'Data diri' },
  ] as const;
</script>

<nav aria-label="Brankas" class="inline-flex gap-1 rounded-2xl bg-bg-2 p-1">
  {#each TAB as t (t.id)}
    <a
      href={t.id === 'berkas' ? resolve('/dokumen') : resolve('/data-diri')}
      aria-current={aktif === t.id ? 'page' : undefined}
      class="inline-flex min-h-12 items-center rounded-xl px-5 text-[0.9375rem] text-ink {aktif === t.id
        ? 'bg-surface font-semibold shadow-lembut'
        : 'hover:bg-card'}">{t.label}</a
    >
  {/each}
</nav>
