import type { KeadaanUrusan, UrusinEvent } from '#lib/contracts.js';

/** State awal kosong untuk layar /urusan/[id]. */
export function keadaanAwal(): KeadaanUrusan {
  return {
    id: null,
    status: 'diam',
    state: null,
    version: 0,
    chainHead: null,
    lastSeq: 0,
    progres: null,
    sedangBerjalan: false,
    jawaban: null,
    handoff: null,
    rencana: null,
    wilayah: null,
    checklist: null,
    kelayakan: null,
    permintaanEksekusi: null,
    gate: null,
    degraded: null,
    galat: null,
    waktuHabis: false,
    teksAsisten: '',
    perluLanjut: false,
    events: [],
  };
}

/** Kosongkan hasil turn sebelumnya saat warga mengirim pesan baru. */
export function mulaiTurnBaru(s: KeadaanUrusan): KeadaanUrusan {
  return {
    ...s,
    sedangBerjalan: true,
    progres: null,
    jawaban: null,
    handoff: null,
    galat: null,
    waktuHabis: false,
    teksAsisten: '',
    perluLanjut: false,
    gate: null,
  };
}

/**
 * Reducer murni: event SSE → state turunan. Event dengan seq yang sudah pernah diterapkan diabaikan
 * (resume/putar ulang tidak menggandakan). Heartbeat tidak mengubah apa pun.
 */
export function terapkanEvent(s: KeadaanUrusan, e: UrusinEvent): KeadaanUrusan {
  if (e.type === 'heartbeat') return s;
  if (e.seq <= s.lastSeq) return s;
  const next: KeadaanUrusan = {
    ...s,
    lastSeq: e.seq,
    chainHead: e.chainHead,
    events: [...s.events, e],
  };
  switch (e.type) {
    case 'state':
      return { ...next, state: e.state, version: e.version };
    case 'progress':
      return { ...next, progres: e.label, sedangBerjalan: true };
    case 'assistant_text':
      return { ...next, teksAsisten: next.teksAsisten + e.delta };
    case 'grounded_answer':
      return { ...next, jawaban: e, handoff: null, progres: null };
    case 'handoff':
      return { ...next, handoff: e, jawaban: null, progres: null };
    case 'plan_card':
      return { ...next, rencana: e };
    case 'wilayah':
      return { ...next, wilayah: e };
    case 'checklist':
      return { ...next, checklist: e };
    case 'eligibility':
      return { ...next, kelayakan: e };
    case 'execution_request':
      return { ...next, permintaanEksekusi: e };
    case 'gate':
      return { ...next, gate: e };
    case 'degraded':
      return { ...next, degraded: e };
    case 'error':
      return { ...next, galat: e, progres: null };
    case 'timeout':
      return { ...next, waktuHabis: true, progres: null };
    case 'done':
      return {
        ...next,
        sedangBerjalan: false,
        progres: null,
        perluLanjut: e.lanjutkan,
        ...(e.version !== undefined ? { version: e.version } : {}),
      };
    case 'policy_gate':
    case 'jejak_pendamping':
    case 'ingatan':
    case 'berkas':
      return next;
  }
}
