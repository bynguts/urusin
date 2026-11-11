import { expect, test } from '@playwright/test';

// Jalur demo Browser Pendamping (DemoProvider, tanpa layanan pendamping di e2e web): pilih Kab. Wonogiri →
// "Ya, betul" (wilayah KTP dipastikan) → rencana akta kelahiran Wonogiri → "Setujui rencana" (aksi terstruktur,
// bukan chat) → kartu "Setujui dan buka situs" → persetujuan tercatat. Tidak ada yang dibuka atau dikirim ke
// situs pemerintah.
test('Setujui rencana menawarkan Browser Pendamping; persetujuan tidak hilang setelah turn berikutnya', async ({
  page,
}) => {
  const panggilan: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (r.request().method() === 'POST' && /\/api\/urusan\/u_[0-9a-f]+\//.test(r.url()))
      panggilan.push({ url: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto('/peristiwa/kelahiran');
  await expect(page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' })).toHaveAttribute(
    'aria-autocomplete',
    'list',
  );
  await page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' }).fill('Wonogiri');
  await page.getByRole('option', { name: 'Kabupaten Wonogiri', exact: true }).click();
  await expect(page).toHaveURL(/kodeKabKota=3312/);
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const id = page.url().split('/').at(-1)!;
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  // Wilayah dulu: pilihan di perangkat hanya usulan; satu klik memastikan KTP Kab. Wonogiri.
  const benar = page.getByRole('button', { name: 'Ya, betul' });
  await expect(benar).toBeEnabled({ timeout: 20_000 });
  await benar.click();
  await expect(log).toContainText('Wilayah KTP: Kabupaten Wonogiri');
  const setujuiRencana = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujuiRencana).toBeEnabled({ timeout: 20_000 });

  const [jawab] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/rencana/setujui')),
    setujuiRencana.click(),
  ]);
  const disetujui = (await jawab.json()) as { state: string; version: number; pendamping: boolean };
  const buka = page.getByRole('button', { name: 'Setujui dan buka situs' });
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  await expect(log).toContainText('Telunjuk Sakti');
  await expect(setujuiRencana).toHaveCount(0);
  expect(panggilan.filter((p) => p.url.endsWith('/turn'))).toHaveLength(0); // bukan pesan chat
  expect(panggilan.find((p) => p.url.endsWith('/wilayah'))?.status).toBe(200);
  expect(panggilan.find((p) => p.url.endsWith('/rencana/setujui'))?.status).toBe(200);
  const st = (await (await page.request.get(`/api/urusan/${id}`)).json()) as {
    state: string;
    version: number;
  };
  expect(st.state).toBe('MENUNGGU_KONFIRMASI');
  // Respons persetujuan membawa versi terbaru (dan event `state` di stream membawa versi yang sama).
  expect(disetujui).toEqual({ state: 'MENUNGGU_KONFIRMASI', version: st.version, pendamping: true });

  // Persetujuan ganda (klik kedua / tab lain) ditolak, state tidak mundur.
  const ulang = await page.evaluate(
    (u) =>
      fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(
        (r) => r.status,
      ),
    `/api/urusan/${id}/rencana/setujui`,
  );
  expect(ulang).toBe(409);

  // Warga masih bertanya lewat chat: rencana tetap disetujui, kartu konfirmasi tetap aktif.
  await page.getByLabel('Tulis jawaban atau pertanyaan').fill('Apa yang perlu saya siapkan?');
  await page.getByRole('button', { name: 'Kirim' }).click();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/urusan/${id}`)).json()) as { berjalan: boolean }).berjalan,
      {
        timeout: 20_000,
      },
    )
    .toBe(false);
  await expect(setujuiRencana).toHaveCount(0);
  // Versi baru dari persetujuan sudah sampai ke klien: pesan berikutnya diterima tanpa 409 + kirim ulang.
  expect(panggilan.filter((p) => p.url.endsWith('/turn')).map((p) => p.status)).toEqual([202]);
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  expect(((await (await page.request.get(`/api/urusan/${id}`)).json()) as { state: string }).state).toBe(
    'MENUNGGU_KONFIRMASI',
  );

  // Warga menyetujui kartu: persetujuan sekali pakai tercatat untuk tool + hash yang ditawarkan.
  await buka.click();
  await expect.poll(() => panggilan.find((p) => p.url.endsWith('/konfirmasi'))?.status).toBe(201);
  await expect.poll(() => panggilan.some((p) => p.url.endsWith('/pendamping'))).toBe(true);
});
