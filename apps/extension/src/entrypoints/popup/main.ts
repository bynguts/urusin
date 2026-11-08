type State = {
  ok: true;
  paired: string | null;
  origins: string[];
  testMode: boolean;
  cursor: { status: string; stepIndex: number; total: number } | null;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<T>;

async function render() {
  const s = await send<State>({ type: 'popup:state' });
  $('pair-status').textContent = s.paired ? `terhubung ke ${s.paired}` : 'belum terhubung';
  $('banner').style.display = s.testMode ? 'block' : 'none';
  $<HTMLInputElement>('test-mode').checked = s.testMode;
  $('exec-status').textContent = s.cursor
    ? `${s.cursor.status} (${s.cursor.stepIndex}/${s.cursor.total})`
    : '-';

  $('origins').replaceChildren(
    ...s.origins.map((origin) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `Hubungkan ke ${origin}`;
      b.dataset.origin = origin;
      b.addEventListener('click', async () => {
        await send({ type: 'popup:pair', origin });
        window.close();
      });
      return b;
    }),
  );
}

// Mode Uji di-toggle HANYA dari popup (rencana §3.5 butir 9).
$('test-mode').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ testMode: (e.target as HTMLInputElement).checked });
  await render();
});
$('unpair').addEventListener('click', async () => {
  await send({ type: 'popup:unpair' });
  await render();
});
$('recheck').addEventListener('click', () => send({ type: 'popup:recheck' }).then(render));
$('cancel').addEventListener('click', () => send({ type: 'popup:cancel' }).then(render));

void render();
