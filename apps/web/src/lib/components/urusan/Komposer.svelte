<script lang="ts">
  import Icon from '../Icon.svelte';

  /** Kotak tulis di bawah percakapan: teks tidak hilang bila pengiriman gagal (WCAG 3.3.7, sesi habis). */
  let {
    teks = $bindable(''),
    sibuk = false,
    nonaktif = false,
    pesan,
    elemen = $bindable(null),
    onkirim,
  }: {
    teks?: string;
    sibuk?: boolean;
    nonaktif?: boolean;
    pesan?: string | null | undefined;
    elemen?: HTMLTextAreaElement | null;
    onkirim: (teks: string) => void;
  } = $props();

  function kirim(e: SubmitEvent) {
    e.preventDefault();
    const t = teks.trim();
    if (!t || sibuk || nonaktif) return;
    onkirim(t);
  }

  function tekan(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }
</script>

<form onsubmit={kirim} class="flex flex-col gap-2">
  {#if pesan}
    <p id="komposer-pesan" role="status" class="px-2 text-sm font-medium text-kuning-ink">{pesan}</p>
  {/if}
  <div class="flex items-end gap-2 rounded-[1.75rem] border border-line-2 bg-surface p-2 pl-5 shadow-lembut">
    <label for="komposer" class="sr-only">Tulis jawaban atau pertanyaan</label>
    <textarea
      id="komposer"
      bind:this={elemen}
      bind:value={teks}
      onkeydown={tekan}
      rows="1"
      maxlength="2000"
      disabled={nonaktif}
      aria-describedby={pesan ? 'komposer-pesan' : undefined}
      placeholder="Tulis jawaban atau pertanyaan lain…"
      class="max-h-40 min-h-12 flex-1 resize-none bg-transparent py-3 text-base text-ink [field-sizing:content] placeholder:text-muted focus:outline-none"
    ></textarea>
    <button
      type="submit"
      disabled={sibuk || nonaktif || !teks.trim()}
      aria-busy={sibuk || undefined}
      class="grid size-12 shrink-0 place-items-center rounded-full bg-primer text-primer-ink hover:opacity-90 disabled:opacity-50"
    >
      <Icon
        name={sibuk ? 'memuat' : 'panah-atas'}
        class="size-5 {sibuk ? 'animate-spin' : ''}"
        label="Kirim"
      />
    </button>
  </div>
</form>
