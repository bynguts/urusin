<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import { domain } from '#lib/urusan-status.js';

  /** Hand-off: belum ada sumber resmi yang cukup, jadi warga diarahkan ke kanal resmi (bukan jawaban karangan). */
  let { handoff }: { handoff: EventOf<'handoff'> } = $props();
</script>

<div class="rounded-2xl border border-line bg-card p-4 sm:p-5">
  <p class="flex items-center gap-2 font-semibold text-ink">
    <Icon name="info" class="size-5 shrink-0" />
    Belum ada sumber resmi untuk ini
  </p>
  <p class="mt-2 text-[0.9375rem] text-body">{handoff.alasan.replace(/\s*\(https?:[^)]+\)/g, '')}</p>
  {#if handoff.kanal.length}
    <ul class="mt-3 flex flex-col gap-2">
      {#each handoff.kanal as k (k.nama + (k.url ?? ''))}
        <li>
          {#if k.url}
            <a
              href={k.url}
              target="_blank"
              rel="external noopener noreferrer"
              class="flex min-h-12 items-center gap-3 rounded-xl border border-line-2 bg-surface px-4 py-2 hover:bg-bg"
            >
              <Icon name="instansi" class="size-5 shrink-0 text-muted" />
              <span class="min-w-0 flex-1">
                <span class="block text-[0.9375rem] font-medium text-ink">{k.nama}</span>
                <span class="block truncate text-sm text-muted">{domain(k.url)}</span>
              </span>
              <Icon name="keluar" class="size-4 shrink-0" />
              <span class="sr-only">(buka di tab baru)</span>
            </a>
          {:else}
            <p class="rounded-xl border border-line-2 bg-surface px-4 py-3 text-[0.9375rem]">
              {k.nama}{k.kontak ? ` · ${k.kontak}` : ''}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
