#!/usr/bin/env node
// Smoke test image rilis kandidat di atas DB hasil migrasi + seed HEAD (lihat job rc-compat di ci.yml):
//   node scripts/rc-compat-smoke.mjs http://127.0.0.1:3000 '{"normal":"u_...","future":"u_..."}'
// Memeriksa: /api/health, daftar urusan memuat kedua urusan, /jejak urusan normal berantai valid,
// dan urusan ber-state dari masa depan terdegradasi dengan baik (bukan 5xx).
const [base, idsJson] = process.argv.slice(2);
if (!base || !idsJson) {
  console.error('pemakaian: rc-compat-smoke.mjs <baseUrl> <json {normal,future}>');
  process.exit(2);
}
const ids = JSON.parse(idsJson);
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${msg}`);
  if (!ok) failures.push(msg);
};

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const health = await get('/api/health');
check(health.status === 200 && health.body?.ok === true, `/api/health 200 ok (status ${health.status})`);

const list = await get(`/api/urusan?ids=${ids.normal},${ids.future}`);
const listed = Array.isArray(list.body?.urusan) ? list.body.urusan.map((u) => u.id) : [];
check(list.status === 200, `GET /api/urusan 200 (status ${list.status})`);
check(listed.includes(ids.normal), 'urusan normal tercantum di daftar');
check(
  listed.includes(ids.future),
  'urusan ber-state masa depan tetap tercantum (tidak membuat daftar gagal)',
);

const jejak = await get(`/api/urusan/${ids.normal}/jejak`);
check(jejak.status === 200, `GET jejak urusan normal 200 (status ${jejak.status})`);
check(jejak.body?.rantai?.valid === true, 'rantai hash audit valid');
// 1 event wilayah ditetapkan + 3 event state (lihat apps/web/scripts/db-seed.mjs)
check(jejak.body?.rantai?.jumlahEvent === 4, `jumlah event 4 (dapat ${jejak.body?.rantai?.jumlahEvent})`);

const future = await get(`/api/urusan/${ids.future}/jejak`);
check(future.status < 500, `jejak urusan ber-state masa depan tidak 5xx (status ${future.status})`);

if (failures.length > 0) {
  console.error(`\nrc-compat-smoke: ${failures.length} pemeriksaan gagal.`);
  process.exit(1);
}
console.log('\nrc-compat-smoke: semua pemeriksaan lolos.');
