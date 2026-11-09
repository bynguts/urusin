import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ChatMessage } from '@urusin/llm';
import {
  canonicalJson,
  chainHash,
  genesisHash,
  sha256,
  verifyRows,
  type ChainVerification,
} from './audit.js';
import type { UrusanState } from '@urusin/contracts';
import type { Db } from './db.js';
import {
  ConflictError,
  IllegalTransitionError,
  NotFoundError,
  TerminalStateError,
  TurnInProgressError,
} from './errors.js';
import { redactForStorage, redactLeaves, type PlaceholderPersistence } from './pii.js';
import { canTransition, isTerminal } from './state.js';

export type UrusanRow = {
  id: string;
  version: number;
  state: UrusanState;
  jenis: string | null;
  kodeKabKota: string | null;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  tokensIn: number;
  tokensOut: number;
  costIdr: number;
};

export type StoredEvent = {
  urusanId: string;
  seq: number;
  type: string;
  payload: unknown;
  at: string;
  hash: string;
};

export type TurnStatus = 'running' | 'done' | 'timeout' | 'error' | 'aborted';

export type SpanInput = {
  urusanId: string;
  turnId?: string | undefined;
  parentId?: string | undefined;
  name: string;
  /** Nilai `gen_ai.operation.name` OTel: chat | execute_tool | retrieval | embeddings, atau `urusin.gate`. */
  operation: string;
  startedAt: Date;
  durationMs: number;
  status: 'ok' | 'error';
  errorCode?: string | undefined;
  model?: string | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  structuredMode?: string | undefined;
  costIdr?: number | undefined;
  degraded?: boolean | undefined;
  /** Atribut non-PII tambahan (nama tool, keputusan gate). Tidak pernah berisi prompt/respons. */
  attrs?: Record<string, string | number | boolean> | undefined;
};

export type ChunkRecord = {
  refId: string;
  text: string;
  url: string;
  judul: string;
  instansi: string;
  verifiedAt: string | null;
};

type UrusanDbRow = {
  id: string;
  version: number;
  state: UrusanState;
  jenis: string | null;
  kode_kabkota: string | null;
  created_at: string;
  updated_at: string;
  turn_count: number;
  tokens_in: number;
  tokens_out: number;
  cost_idr: number;
};

const toUrusan = (r: UrusanDbRow): UrusanRow => ({
  id: r.id,
  version: r.version,
  state: r.state,
  jenis: r.jenis,
  kodeKabKota: r.kode_kabkota,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  turnCount: r.turn_count,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  costIdr: r.cost_idr,
});

export type StoreOptions = {
  now?: () => Date;
  /** Id instance proses ini (acak per proses). Turn yang diklaim instance lain tidak boleh diambil alih. */
  instanceId?: string;
  /** Masa berlaku lease turn; diperpanjang berkala selama turn berjalan. */
  leaseMs?: number;
  /** Rahasia HMAC untuk kunci pemetaan placeholder (URUSIN_PII_KEY). Default acak per proses: antar-restart token baru, tetap aman. */
  piiKey?: string;
};

/**
 * Akses data harness. Semua tulisan yang perlu atomik memakai `BEGIN IMMEDIATE` (`.immediate()`),
 * sehingga dua koneksi/proses tidak bisa berebut klaim. Semua teks bebas dilewatkan `redactForStorage`:
 * database tidak pernah memuat NIK/KK/HP/email asli (hanya placeholder).
 */
export class HarnessStore {
  private readonly now: () => Date;
  readonly instanceId: string;
  readonly leaseMs: number;
  private readonly piiKey: string;

  constructor(
    readonly db: Db,
    opts: StoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.instanceId = opts.instanceId ?? `i_${randomBytes(8).toString('hex')}`;
    this.leaseMs = opts.leaseMs ?? 30_000;
    this.piiKey = opts.piiKey ?? randomBytes(32).toString('hex');
  }

  /** Pemetaan placeholder yang bertahan antar turn (kunci di-HMAC; tidak ada nilai asli di DB). */
  placeholderPersistence(urusanId: string): PlaceholderPersistence {
    const entries = this.db
      .prepare('SELECT key, kind, token FROM pii_placeholders WHERE urusan_id = ?')
      .all(urusanId) as { key: string; kind: string; token: string }[];
    return {
      key: (kind, normalized) =>
        createHmac('sha256', this.piiKey).update(`${urusanId}|${kind}|${normalized}`).digest('hex'),
      entries,
      save: (key, kind, token) => {
        this.db
          .prepare('INSERT OR IGNORE INTO pii_placeholders (urusan_id, key, kind, token) VALUES (?,?,?,?)')
          .run(urusanId, key, kind, token);
      },
    };
  }

  private leaseUntil(): string {
    return new Date(this.now().getTime() + this.leaseMs).toISOString();
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // --- urusan + state machine (CAS) ---

  createUrusan(input: { kodeKabKota?: string | undefined; jenis?: string | undefined } = {}): UrusanRow {
    const id = `u_${randomBytes(16).toString('hex')}`;
    const at = this.iso();
    this.db
      .prepare(
        `INSERT INTO urusan (id, version, state, jenis, kode_kabkota, created_at, updated_at)
         VALUES (?, 0, 'BARU', ?, ?, ?, ?)`,
      )
      .run(id, input.jenis ?? null, input.kodeKabKota ?? null, at, at);
    return this.getUrusanOrThrow(id);
  }

  getUrusan(id: string): UrusanRow | undefined {
    const r = this.db.prepare('SELECT * FROM urusan WHERE id = ?').get(id) as UrusanDbRow | undefined;
    return r ? toUrusan(r) : undefined;
  }

  getUrusanOrThrow(id: string): UrusanRow {
    const u = this.getUrusan(id);
    if (!u) throw new NotFoundError();
    return u;
  }

  /**
   * Transisi state dengan compare-and-swap: `UPDATE ... WHERE id=? AND version=?`.
   * Transisi ilegal ditolak (422); version basi ditolak (409). Mengembalikan baris terbaru.
   */
  transition(id: string, expectedVersion: number, to: UrusanState): UrusanRow {
    const tx = this.db.transaction(() => {
      const cur = this.getUrusanOrThrow(id);
      if (cur.version !== expectedVersion) throw new ConflictError();
      if (!canTransition(cur.state, to)) throw new IllegalTransitionError(cur.state, to);
      const res = this.db
        .prepare(
          'UPDATE urusan SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
        )
        .run(to, this.iso(), id, expectedVersion);
      if (res.changes !== 1) throw new ConflictError();
      return this.getUrusanOrThrow(id);
    });
    return tx.immediate();
  }

  setJenis(id: string, expectedVersion: number, jenis: string): UrusanRow {
    const res = this.db
      .prepare(
        'UPDATE urusan SET jenis = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
      )
      .run(jenis, this.iso(), id, expectedVersion);
    if (res.changes !== 1) throw new ConflictError();
    return this.getUrusanOrThrow(id);
  }

  // --- turns ---

  /**
   * Klaim satu turn (BEGIN IMMEDIATE). Gagal bila versi basi (409), ada turn berjalan (409, dijaga
   * indeks unik parsial), atau urusan sudah berakhir. Menaikkan `version`.
   */
  claimTurn(
    urusanId: string,
    userText: string,
    opts: { expectedVersion?: number } = {},
  ): { turnId: string; seq: number; version: number } {
    const tx = this.db.transaction(() => {
      const u = this.getUrusanOrThrow(urusanId);
      if (isTerminal(u.state)) throw new TerminalStateError(u.state);
      if (opts.expectedVersion !== undefined && u.version !== opts.expectedVersion) throw new ConflictError();
      // Turn yatim (pemilik mati, lease lewat) dilepas di sini juga: reaper saat boot saja tidak cukup pada blue/green.
      const now = this.iso();
      const yatim = this.db
        .prepare(
          "UPDATE turns SET status = 'error', error_code = 'ABANDONED', ended_at = ? WHERE urusan_id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until < ?)",
        )
        .run(now, urusanId, now).changes;
      if (yatim > 0) {
        this.appendEvent(urusanId, 'error', {
          kode: 'ABORTED',
          pesanWarga: 'Proses sebelumnya terhenti karena server dipindahkan. Silakan lanjutkan.',
          bisaUlang: true,
        });
      }
      const running = this.db
        .prepare("SELECT 1 FROM turns WHERE urusan_id = ? AND status = 'running'")
        .get(urusanId);
      if (running) throw new TurnInProgressError();
      const turnId = `t_${randomUUID()}`;
      const seq = u.turnCount + 1;
      this.db
        .prepare(
          `INSERT INTO turns (id, urusan_id, seq, status, user_text, started_at, owner_instance, lease_until)
           VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
        )
        .run(
          turnId,
          urusanId,
          seq,
          redactForStorage(userText),
          this.iso(),
          this.instanceId,
          this.leaseUntil(),
        );
      const res = this.db
        .prepare(
          'UPDATE urusan SET version = version + 1, turn_count = turn_count + 1, updated_at = ? WHERE id = ? AND version = ?',
        )
        .run(this.iso(), urusanId, u.version);
      if (res.changes !== 1) throw new ConflictError();
      return { turnId, seq, version: u.version + 1 };
    });
    return tx.immediate();
  }

  finishTurn(
    turnId: string,
    patch: {
      status: Exclude<TurnStatus, 'running'>;
      messages: readonly ChatMessage[];
      tokensIn: number;
      tokensOut: number;
      costIdr: number;
      degraded: boolean;
      errorCode?: string | undefined;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE turns SET status = ?, messages = ?, ended_at = ?, tokens_in = ?, tokens_out = ?, cost_idr = ?,
         degraded = ?, error_code = ? WHERE id = ?`,
      )
      .run(
        patch.status,
        JSON.stringify(redactLeaves(patch.messages)),
        this.iso(),
        patch.tokensIn,
        patch.tokensOut,
        patch.costIdr,
        patch.degraded ? 1 : 0,
        patch.errorCode ?? null,
        turnId,
      );
  }

  /** Perpanjang lease turn milik instance ini. false bila turn sudah bukan milik/berjalan di instance ini. */
  renewLease(turnId: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE turns SET lease_until = ? WHERE id = ? AND status = 'running' AND owner_instance = ?",
        )
        .run(this.leaseUntil(), turnId, this.instanceId).changes === 1
    );
  }

  /**
   * Tandai turn yang lease-nya sudah lewat (proses pemiliknya mati) sebagai error agar urusan bisa dilanjutkan.
   * Turn yang lease-nya masih berlaku, termasuk milik instance lain di DB yang sama (blue/green), TIDAK disentuh.
   */
  reapExpiredTurns(): number {
    const now = this.iso();
    return this.db
      .prepare(
        "UPDATE turns SET status = 'error', error_code = 'ABANDONED', ended_at = ? WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ?)",
      )
      .run(now, now).changes;
  }

  /** Riwayat percakapan (pesan pengguna + pesan turn) untuk `maxTurns` turn terakhir yang selesai. */
  loadHistory(urusanId: string, maxTurns = 12): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT user_text, messages FROM turns WHERE urusan_id = ? AND status != 'running'
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(urusanId, maxTurns) as { user_text: string; messages: string }[];
    return rows.reverse().flatMap((r) => JSON.parse(r.messages) as ChatMessage[]);
  }

  // --- events (audit hash chain + sumber replay SSE) ---

  appendEvent(urusanId: string, type: string, payload: unknown): StoredEvent {
    const tx = this.db.transaction(() => {
      const u = this.getUrusanOrThrow(urusanId);
      const last = this.db
        .prepare('SELECT seq, hash FROM events WHERE urusan_id = ? ORDER BY seq DESC LIMIT 1')
        .get(urusanId) as { seq: number; hash: string } | undefined;
      const prev = last?.hash ?? genesisHash(u.id, u.createdAt);
      const seq = (last?.seq ?? 0) + 1;
      const at = this.iso();
      const body = canonicalJson(redactLeaves(payload));
      const hash = chainHash(prev, { seq, type, at, payload: body });
      this.db
        .prepare(
          'INSERT INTO events (urusan_id, seq, type, payload, at, prev_hash, hash) VALUES (?,?,?,?,?,?,?)',
        )
        .run(urusanId, seq, type, body, at, prev, hash);
      return { urusanId, seq, type, payload: JSON.parse(body) as unknown, at, hash };
    });
    return tx.immediate();
  }

  eventsAfter(urusanId: string, afterSeq = 0, limit = 1000): StoredEvent[] {
    const rows = this.db
      .prepare(
        'SELECT seq, type, payload, at, hash FROM events WHERE urusan_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      )
      .all(urusanId, afterSeq, limit) as {
      seq: number;
      type: string;
      payload: string;
      at: string;
      hash: string;
    }[];
    return rows.map((r) => ({ urusanId, ...r, payload: JSON.parse(r.payload) as unknown }));
  }

  chainHead(urusanId: string): string {
    const u = this.getUrusanOrThrow(urusanId);
    const last = this.db
      .prepare('SELECT hash FROM events WHERE urusan_id = ? ORDER BY seq DESC LIMIT 1')
      .get(urusanId) as { hash: string } | undefined;
    return last?.hash ?? genesisHash(u.id, u.createdAt);
  }

  /** Verifikasi rantai; `expectedHead` = head yang dipegang klien (mendeteksi pemotongan/penulisan ulang server). */
  verifyChain(urusanId: string, expectedHead?: string): ChainVerification {
    const u = this.getUrusanOrThrow(urusanId);
    const rows = this.db
      .prepare('SELECT seq, type, payload, at, prev_hash, hash FROM events WHERE urusan_id = ? ORDER BY seq')
      .all(urusanId) as {
      seq: number;
      type: string;
      payload: string;
      at: string;
      prev_hash: string;
      hash: string;
    }[];
    return verifyRows(u.id, u.createdAt, rows, expectedHead);
  }

  /** Hak hapus (UU PDP): hapus seluruh rantai + data urusan, sisakan tombstone tanpa isi. */
  deleteUrusan(urusanId: string): { urusanHash: string; headHash: string } {
    const tx = this.db.transaction(() => {
      const head = this.chainHead(urusanId);
      const urusanHash = sha256(urusanId);
      this.db
        .prepare('INSERT OR REPLACE INTO tombstones (urusan_hash, head_hash, deleted_at) VALUES (?,?,?)')
        .run(urusanHash, head, this.iso());
      this.db.prepare('DELETE FROM urusan WHERE id = ?').run(urusanId); // cascade ke tabel anak
      return { urusanHash, headHash: head };
    });
    return tx.immediate();
  }

  // --- spans ---

  recordSpan(s: SpanInput): string {
    const id = `s_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO spans (id, urusan_id, turn_id, parent_id, name, operation, started_at, duration_ms, status,
           error_code, model, tokens_in, tokens_out, structured_mode, cost_idr, degraded, attrs)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        s.urusanId,
        s.turnId ?? null,
        s.parentId ?? null,
        s.name,
        s.operation,
        s.startedAt.toISOString(),
        Math.max(0, Math.round(s.durationMs)),
        s.status,
        s.errorCode ?? null,
        s.model ?? null,
        s.tokensIn ?? null,
        s.tokensOut ?? null,
        s.structuredMode ?? null,
        s.costIdr ?? null,
        s.degraded ? 1 : 0,
        JSON.stringify(redactLeaves(s.attrs ?? {})),
      );
    return id;
  }

  // --- konfirmasi (dibuat WARGA lewat UI; LLM hanya bisa menyebut id) ---

  createConfirmation(urusanId: string, tool: string, params: unknown, ttlMs = 10 * 60_000): string {
    return this.createConfirmationByHash(urusanId, tool, paramsHash(tool, params), ttlMs).id;
  }

  /** Konfirmasi atas hash parameter yang ditampilkan ke warga (dari event execution_request). */
  createConfirmationByHash(
    urusanId: string,
    tool: string,
    hash: string,
    ttlMs = 10 * 60_000,
  ): { id: string; expiresAt: string } {
    // Id ini ditulis ulang oleh model sebagai parameter tool, dan gerbang PII memindai parameter. Hex acak
    // kadang memuat deret digit mirip HP/NIK (mis. 0812...), sehingga konfirmasi sah ditolak. Digit hex
    // dipetakan ke huruf g-p: tetap 128 bit acak, tanpa satu digit pun.
    const id = `c_${randomBytes(16)
      .toString('hex')
      .replace(/\d/g, (d) => 'ghijklmnop'.charAt(Number(d)))}`;
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db
      .prepare('INSERT INTO confirmations (id, urusan_id, tool, params_hash, expires_at) VALUES (?,?,?,?,?)')
      .run(id, urusanId, tool, hash, expiresAt);
    return { id, expiresAt };
  }

  /**
   * Event bertipe `execution_request` atau `gate` yang benar-benar pernah dikirim ke warga pada urusan ini,
   * cocok pada field yang diberikan. Klien tidak bisa menyetujui/melaporkan sesuatu yang tidak pernah ditawarkan.
   */
  findOffered(
    urusanId: string,
    type: 'execution_request' | 'gate',
    match: { executionId?: string; tool?: string; paramsHash?: string },
  ): { executionId?: string; tool: string; paramsHash: string } | undefined {
    const rows = this.db
      .prepare('SELECT payload FROM events WHERE urusan_id = ? AND type = ? ORDER BY seq DESC')
      .all(urusanId, type) as { payload: string }[];
    for (const r of rows) {
      const p = JSON.parse(r.payload) as { executionId?: string; tool?: string; paramsHash?: string };
      if (
        p.tool !== undefined &&
        p.paramsHash !== undefined &&
        (match.executionId === undefined || p.executionId === match.executionId) &&
        (match.tool === undefined || p.tool === match.tool) &&
        (match.paramsHash === undefined || p.paramsHash === match.paramsHash)
      )
        return { ...p, tool: p.tool, paramsHash: p.paramsHash };
    }
    return undefined;
  }

  /** false bila hasil untuk executionId ini sudah pernah dicatat. */
  recordExecutionResult(urusanId: string, executionId: string, status: string): boolean {
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO execution_results (execution_id, urusan_id, status, at) VALUES (?,?,?,?)',
        )
        .run(executionId, urusanId, status, this.iso()).changes === 1
    );
  }

  listUrusan(ids: readonly string[]): UrusanRow[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT * FROM urusan WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY updated_at DESC`)
      .all(...ids) as UrusanDbRow[];
    return rows.map(toUrusan);
  }

  getConfirmation(id: string):
    | {
        id: string;
        urusanId: string;
        tool: string;
        paramsHash: string;
        expiresAt: string;
        usedAt: string | null;
      }
    | undefined {
    const r = this.db.prepare('SELECT * FROM confirmations WHERE id = ?').get(id) as
      | {
          id: string;
          urusan_id: string;
          tool: string;
          params_hash: string;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;
    return (
      r && {
        id: r.id,
        urusanId: r.urusan_id,
        tool: r.tool,
        paramsHash: r.params_hash,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
      }
    );
  }

  /** Konfirmasi warga yang masih berlaku (belum terpakai/kedaluwarsa); LLM hanya diberi tahu id-nya. */
  activeConfirmations(urusanId: string): { id: string; tool: string }[] {
    return this.db
      .prepare(
        'SELECT id, tool FROM confirmations WHERE urusan_id = ? AND used_at IS NULL AND expires_at > ?',
      )
      .all(urusanId, this.iso()) as { id: string; tool: string }[];
  }

  /** Tandai terpakai (sekali pakai). false bila sudah terpakai (race). */
  consumeConfirmation(id: string): boolean {
    return (
      this.db
        .prepare('UPDATE confirmations SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .run(this.iso(), id).changes === 1
    );
  }

  /** Kembalikan konfirmasi yang sudah dikonsumsi bila turn gagal sebelum tindakan sampai ke warga. */
  releaseConfirmation(id: string): void {
    this.db.prepare('UPDATE confirmations SET used_at = NULL WHERE id = ?').run(id);
  }

  // --- potongan korpus yang sah dikutip ---

  saveChunks(urusanId: string, chunks: readonly ChunkRecord[]): void {
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO retrieved_chunks (urusan_id, ref_id, text, url, judul, instansi, verified_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    this.db
      .transaction(() => {
        for (const c of chunks) ins.run(urusanId, c.refId, c.text, c.url, c.judul, c.instansi, c.verifiedAt);
      })
      .immediate();
  }

  getChunks(urusanId: string): ChunkRecord[] {
    const rows = this.db
      .prepare(
        'SELECT ref_id, text, url, judul, instansi, verified_at FROM retrieved_chunks WHERE urusan_id = ?',
      )
      .all(urusanId) as {
      ref_id: string;
      text: string;
      url: string;
      judul: string;
      instansi: string;
      verified_at: string | null;
    }[];
    return rows.map((r) => ({
      refId: r.ref_id,
      text: r.text,
      url: r.url,
      judul: r.judul,
      instansi: r.instansi,
      verifiedAt: r.verified_at,
    }));
  }

  // --- pemakaian / biaya ---

  addUsage(
    urusanId: string,
    u: { tokensIn: number; tokensOut: number; costIdr: number; degraded: boolean },
  ): void {
    const day = this.iso().slice(0, 10);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            'UPDATE urusan SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_idr = cost_idr + ? WHERE id = ?',
          )
          .run(u.tokensIn, u.tokensOut, u.costIdr, urusanId);
        this.db
          .prepare(
            `INSERT INTO daily_usage (day, requests, degraded_requests, tokens_in, tokens_out, cost_idr)
             VALUES (?, 1, ?, ?, ?, ?)
             ON CONFLICT(day) DO UPDATE SET requests = requests + 1, degraded_requests = degraded_requests + ?,
               tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_idr = cost_idr + ?`,
          )
          .run(
            day,
            u.degraded ? 1 : 0,
            u.tokensIn,
            u.tokensOut,
            u.costIdr,
            u.degraded ? 1 : 0,
            u.tokensIn,
            u.tokensOut,
            u.costIdr,
          );
      })
      .immediate();
  }

  dailyCostIdr(day = this.iso().slice(0, 10)): number {
    const r = this.db.prepare('SELECT cost_idr FROM daily_usage WHERE day = ?').get(day) as
      { cost_idr: number } | undefined;
    return r?.cost_idr ?? 0;
  }
}

/** Hash parameter yang disetujui: tool + parameter tanpa `confirmationId`. */
export function paramsHash(tool: string, params: unknown): string {
  const p = (
    params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : params
  ) as unknown;
  if (p && typeof p === 'object') delete (p as Record<string, unknown>).confirmationId;
  return sha256(canonicalJson({ tool, params: p }));
}
