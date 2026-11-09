<script lang="ts">
  import Icon from '../Icon.svelte';

  /** Input kata sandi dengan tombol lihat/sembunyikan. Tanpa JS tetap input password biasa. */
  let {
    id,
    name = 'sandi',
    autocomplete,
    describedby,
    invalid = false,
  }: {
    id: string;
    name?: string;
    autocomplete: 'current-password' | 'new-password';
    describedby?: string | undefined;
    invalid?: boolean;
  } = $props();
  let lihat = $state(false);
</script>

<div class="relative">
  <input
    {id}
    {name}
    type={lihat ? 'text' : 'password'}
    {autocomplete}
    required
    minlength={autocomplete === 'new-password' ? 10 : undefined}
    maxlength="128"
    aria-describedby={describedby}
    aria-invalid={invalid}
    class="h-14 w-full rounded-2xl border bg-surface pr-14 pl-4 text-base text-ink {invalid
      ? 'border-galat-garis'
      : 'border-line-2'}"
  />
  <button
    type="button"
    onclick={() => (lihat = !lihat)}
    aria-pressed={lihat}
    aria-controls={id}
    class="absolute top-1 right-1 grid size-12 place-items-center rounded-xl text-body hover:bg-bg-2"
  >
    <Icon name={lihat ? 'mata-tutup' : 'mata'} class="size-5" />
    <span class="sr-only">{lihat ? 'Sembunyikan' : 'Tampilkan'} sandi</span>
  </button>
</div>
