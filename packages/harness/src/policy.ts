import { ErrorCode, findGuardIssues, matchOfficialOrigin } from '@urusin/core';
import type { z } from 'zod';
import type { GateRule, UrusanState } from '@urusin/contracts';
import type { QuotaStatus } from './quota.js';
import { paramsHash, type HarnessStore, type UrusanRow } from './store.js';
import { CONFIRMATION_FIELD, modelFacingSchema, type ToolDef, type ToolRegistry } from './tools.js';
import { ADMINDUK } from './grounding.js';
import { wilayahBelumSiap, wilayahUrusan } from './wilayah.js';

export type GateInput = {
  urusan: UrusanRow;
  state: UrusanState;
  toolName: string;
  /** Argumen mentah dari model (sudah di-JSON.parse). */
  rawArgs: unknown;
  quota: QuotaStatus;
};

export type GateOutcome =
  | {
      allow: true;
      tool: ToolDef;
      args: unknown;
      /** Hash parameter yang dipakai konfirmasi (hanya untuk write). */
      paramsHash?: string;
      confirmationId?: string;
    }
  | { allow: false; rule: GateRule; message: string; toolKnown: boolean; paramsHash?: string };

const deny = (rule: GateRule, message: string, toolKnown = true): GateOutcome => ({
  allow: false,
  rule,
  message,
  toolKnown,
});

/**
 * Policy engine: SATU-SATUNYA jalan menuju eksekusi tool, baik di mode tool-calling maupun mode degraded
 * "JSON satu aksi". Urutan (rencana §3.2): (1) tool diizinkan di state ini, (2) zod + `noPlaceholder` lolos,
 * (3) tool tulis butuh `confirmationId` yang hash-parameternya cocok dan belum kedaluwarsa, (4) origin ada di
 * registry, (5) kuota OK. Tool `final` tidak pernah lolos. Konfirmasi baru dikonsumsi setelah SEMUA cek lulus.
 */
export class PolicyGate {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly store: HarnessStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  evaluate(input: GateInput): GateOutcome {
    const tool = this.registry.get(input.toolName);
    if (!tool) return deny('UNKNOWN_TOOL', `tool "${input.toolName}" tidak ditemukan`, false);

    // (0) tool `final` hanya boleh dilakukan warga lewat gate.human.
    if (tool.effect === 'final') {
      return deny('FINAL_REQUIRES_CITIZEN', 'pengiriman akhir hanya boleh dilakukan warga sendiri');
    }

    // (1) tool diizinkan di state ini.
    if (!tool.allowedStates.includes(input.state)) {
      return deny('TOOL_NOT_ALLOWED_IN_STATE', `tool ini tidak tersedia pada tahap ${input.state}`);
    }

    // (1b) gerbang wilayah: rencana tidak boleh disusun sebelum wilayah KTP dipastikan warga (dikunci di kode).
    if (tool.butuhWilayah === true) {
      const belum = wilayahBelumSiap(input.urusan.jenis, wilayahUrusan(this.store, input.urusan));
      if (belum) return deny('WILAYAH_BELUM_DITETAPKAN', belum);
    }
    // Jawaban persyaratan kependudukan juga menunggu wilayah dipastikan warga (kartu usulan saja belum cukup):
    // aturan dan kanal berbeda per kab/kota.
    const jenis = input.urusan.jenis;
    if (tool.butuhWilayah === 'adminduk' && jenis !== null && ADMINDUK.has(jenis)) {
      const w = wilayahUrusan(this.store, input.urusan);
      const belum = w.ktp ? undefined : wilayahBelumSiap(jenis === 'pindah' ? null : jenis, w);
      if (belum) return deny('WILAYAH_BELUM_DITETAPKAN', belum);
    }

    // (2) lapis 2 PII: tolak placeholder/PII di SEMUA string yang ditulis model, sebelum zod.
    const issues = findGuardIssues(input.rawArgs);
    if (issues.length > 0) {
      return deny(
        'PLACEHOLDER_OR_PII_IN_PARAM',
        `parameter ditolak: ${issues[0]?.code ?? ErrorCode.PII_IN_LLM_PARAM}`,
      );
    }
    const parsed = modelFacingSchema(tool).safeParse(input.rawArgs ?? {});
    if (!parsed.success) return deny('SCHEMA_INVALID', 'parameter tidak sesuai skema tool');
    const { [CONFIRMATION_FIELD]: confirmationId, ...args } = parsed.data as Record<string, unknown>;
    const cleanArgs = tool.effect === 'write' ? args : parsed.data;

    // (3) tool tulis butuh konfirmasi yang cocok.
    let hash: string | undefined;
    if (tool.effect === 'write') {
      if (typeof confirmationId !== 'string' || confirmationId.length === 0) {
        return {
          ...deny('CONFIRMATION_REQUIRED', 'tindakan ini membutuhkan konfirmasi warga terlebih dahulu'),
          paramsHash: paramsHash(tool.name, cleanArgs),
        };
      }
      const conf = this.store.getConfirmation(confirmationId);
      if (!conf || conf.urusanId !== input.urusan.id || conf.tool !== tool.name || conf.usedAt) {
        return deny('CONFIRMATION_MISMATCH', 'konfirmasi tidak dikenal atau sudah terpakai');
      }
      if (Date.parse(conf.expiresAt) <= this.now().getTime()) {
        return deny('CONFIRMATION_EXPIRED', 'konfirmasi sudah kedaluwarsa');
      }
      hash = paramsHash(tool.name, cleanArgs);
      if (hash !== conf.paramsHash) {
        return deny('CONFIRMATION_MISMATCH', 'parameter berbeda dari yang disetujui warga');
      }
    }

    // (4) origin harus terdaftar di registry domain resmi.
    const origin = tool.origin?.(cleanArgs as z.infer<typeof tool.input>, { urusan: input.urusan });
    if (tool.effect === 'write' && origin === undefined) {
      return deny('ORIGIN_NOT_OFFICIAL', 'tujuan tidak punya origin resmi terdaftar');
    }
    if (origin !== undefined && !matchOfficialOrigin(origin).ok) {
      return deny('ORIGIN_NOT_OFFICIAL', 'origin tujuan tidak ada di registry domain resmi');
    }

    // (5) kuota: tool tulis berhenti saat kuota habis.
    if (tool.effect === 'write' && input.quota.mode === 'habis') {
      return deny('QUOTA_EXCEEDED', 'kuota layanan AI habis; gunakan jalur dipandu');
    }

    if (tool.effect === 'write' && typeof confirmationId === 'string') {
      if (!this.store.consumeConfirmation(confirmationId)) {
        return deny('CONFIRMATION_MISMATCH', 'konfirmasi sudah terpakai');
      }
    }
    return {
      allow: true,
      tool,
      args: cleanArgs,
      ...(hash ? { paramsHash: hash } : {}),
      ...(typeof confirmationId === 'string' ? { confirmationId } : {}),
    };
  }
}
