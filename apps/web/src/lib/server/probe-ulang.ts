import { CAPABILITIES, type Capability, type CapabilityFlags, type CapabilityReport } from '@urusin/llm';

/**
 * Probe kapabilitas LLM yang gagal saat boot (proxy sibuk, timeout, balasan rusak) TIDAK boleh membuat runtime
 * degraded selamanya: probe diulang di latar dengan backoff sampai kapabilitas inti agen terjawab, dan setiap
 * kapabilitas yang lolos langsung dinyalakan di `caps` runtime (objek yang sama dengan `rt.deps.caps`).
 */

/** Jeda probe ulang: 15 s, 30 s, 60 s, 2 menit, 4 menit, lalu tiap 5 menit. */
export const JEDA_PROBE_MS = [15_000, 30_000, 60_000, 120_000, 240_000, 300_000] as const;

/** Kapabilitas model agen; probe-nya yang GALAT (bukan jawaban "tidak didukung") memicu probe ulang. */
const INTI: readonly Capability[] = ['tools', 'parallel_tool_calls', 'json_schema_strict', 'streaming_tools'];

export type StatusProbe =
  | { status: 'pin' }
  | { status: 'ok'; percobaan: number }
  | { status: 'mencoba_ulang'; percobaan: number; berikutnyaPada: string; galat: Capability[] };

let status: StatusProbe | undefined;

/** Status probe proses ini; undefined = mode demo / runtime belum dirakit. */
export const statusProbe = (): StatusProbe | undefined => status;

/** Untuk uji dan LLM_CAPS_PIN. */
export function aturStatusProbe(s: StatusProbe | undefined): void {
  status = s;
}

/** Kapabilitas inti yang probenya galat (jaringan, timeout, balasan bukan chat.completion). */
export function probeGalat(laporan: CapabilityReport | null): Capability[] {
  if (!laporan) return [...INTI];
  return INTI.filter((c) => {
    const d = laporan.details[c];
    return !d.ok && !d.skipped && d.error !== undefined;
  });
}

export type PantauProbe = {
  /** `rt.deps.caps`: diubah di tempat (hanya dinyalakan, tidak pernah dimatikan oleh probe ulang). */
  caps: CapabilityFlags;
  /** Hasil probe boot (null = probe melempar). */
  laporan: CapabilityReport | null;
  /** Probe ulang (sudah menerapkan LLM_FORCE_NO_*). */
  probe: () => Promise<CapabilityReport>;
  jadwal?: (fn: () => void, ms: number) => void;
  now?: () => number;
  catat?: (pesan: string) => void;
};

/** Nilai hasil probe boot lalu jadwalkan probe ulang selama kapabilitas inti masih galat. */
export function pantauProbe(o: PantauProbe): void {
  const jadwal = o.jadwal ?? ((fn, ms) => void setTimeout(fn, ms).unref());
  const now = o.now ?? Date.now;
  const catat = o.catat ?? ((p) => console.warn(p));
  let percobaan = 1;
  const nilai = (laporan: CapabilityReport | null) => {
    if (laporan) for (const c of CAPABILITIES) if (laporan.flags[c]) o.caps[c] = true;
    const galat = probeGalat(laporan);
    if (galat.length === 0) {
      if (percobaan > 1) catat(`kapabilitas LLM pulih pada percobaan ${percobaan}`);
      status = { status: 'ok', percobaan };
      return;
    }
    const ms = JEDA_PROBE_MS[Math.min(percobaan - 1, JEDA_PROBE_MS.length - 1)]!;
    status = {
      status: 'mencoba_ulang',
      percobaan,
      berikutnyaPada: new Date(now() + ms).toISOString(),
      galat,
    };
    catat(`probe kapabilitas LLM galat (${galat.join(',')}); ulang dalam ${ms / 1000} s`);
    jadwal(() => {
      percobaan += 1;
      o.probe().then(nilai, () => nilai(null));
    }, ms);
  };
  nilai(o.laporan);
}
