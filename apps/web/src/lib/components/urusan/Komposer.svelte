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
  <div
    class="flex min-h-14 items-end gap-2 rounded-[28px] border border-line-2 bg-surface py-[6px] pr-[7px] pl-5 shadow-[0_0_0.5px_#0000000f,0_1px_0.5px_#0000000f,0_2px_2px_#0000000a]"
  >
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
      placeholder="Tulis jawaban atau pertanyaan lanjutan…"
      class="max-h-40 min-h-[42px] flex-1 resize-none bg-transparent py-2 text-base text-ink [field-sizing:content] placeholder:text-muted focus:outline-none sm:text-[17px] sm:leading-[26px]"
    ></textarea>
    <button
      type="submit"
      disabled={sibuk || nonaktif || !teks.trim()}
      aria-busy={sibuk || undefined}
      class="grid size-[42px] shrink-0 place-items-center rounded-full bg-primer text-primer-ink disabled:opacity-50"
    >
      <Icon
        name={sibuk ? 'memuat' : 'panah-atas'}
        class="size-5 {sibuk ? 'animate-spin' : ''}"
        label="Kirim"
      />
    </button>
  </div>
</form>
