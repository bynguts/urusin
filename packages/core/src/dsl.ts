import { z } from 'zod';
import { ErrorCode, UrusinError } from './errors.js';
import { hasMalformedPlaceholder } from './placeholder.js';
import { matchOfficialOrigin } from './registry.js';

/**
 * Step DSL adapter deklaratif (rencana §3.4).
 *
 * effect:
 *  - read  : hanya membaca (navigasi, klik tab)
 *  - input : mengisi field di halaman, belum mengirim apa pun
 *  - write : mengubah data di server situs (wajib `verify`)
 *  - final : pengiriman akhir; HANYA boleh `gate.human` (diklik warga sendiri)
 */
export const EFFECTS = ['read', 'input', 'write', 'final'] as const;
export type Effect = (typeof EFFECTS)[number];

export type Selector =
  | { by: 'label'; value: string }
  | { by: 'role'; value: string; name?: string }
  | { by: 'name'; value: string }
  | { by: 'text'; value: string }
  | { by: 'css'; value: string };

/** Rantai selector berlapis: dicoba berurutan, gagal semua = ADAPTER_DRIFT. */
export type Target = Selector[];

export type Check =
  | { kind: 'urlIncludes'; value: string }
  | { kind: 'textIncludes'; value: string }
  | { kind: 'elementExists'; target: Target }
  | { kind: 'countIncreased'; target: Target };

export type Step =
  | { op: 'nav'; path: string; effect: Effect }
  | { op: 'waitFor'; check: Check; timeoutMs?: number | undefined; effect: Effect }
  | { op: 'fill'; target: Target; value: string; effect: Effect }
  | { op: 'select'; target: Target; value: string; effect: Effect }
  | { op: 'upload'; target: Target; file: string; effect: Effect }
  | {
      op: 'click';
      target: Target;
      effect: Effect;
      verify?: Check | undefined;
      expectReload?: boolean | undefined;
    }
  | { op: 'verify'; check: Check; effect: Effect }
  | { op: 'extract'; mode: 'table' | 'text'; target: Target; into: string; effect: Effect }
  | {
      op: 'gate.human';
      message: string;
      /** Pesan pengganti bila `check` benar di halaman saat gerbang dibuka (mis. kolom sandi memang ada). */
      messageIf?: { check: Check; message: string } | undefined;
      until: Check;
      highlight?: Target | undefined;
      effect: Effect;
    }
  | { op: 'forEach'; over: string; steps: Step[] }
  | { op: 'branch'; when: Check; then: Step[]; else?: Step[] | undefined };

export type StepOp = Step['op'];

const nonEmpty = z.string().min(1);

export const SelectorSchema: z.ZodType<Selector> = z.discriminatedUnion('by', [
  z.object({ by: z.literal('label'), value: nonEmpty }),
  z.object({ by: z.literal('role'), value: nonEmpty, name: nonEmpty.optional() }),
  z.object({ by: z.literal('name'), value: nonEmpty }),
  z.object({ by: z.literal('text'), value: nonEmpty }),
  z.object({ by: z.literal('css'), value: nonEmpty }),
]);

export const TargetSchema = z.array(SelectorSchema).min(1);

export const CheckSchema: z.ZodType<Check> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('urlIncludes'), value: nonEmpty }),
  z.object({ kind: z.literal('textIncludes'), value: nonEmpty }),
  z.object({ kind: z.literal('elementExists'), target: TargetSchema }),
  z.object({ kind: z.literal('countIncreased'), target: TargetSchema }),
]);

const EffectSchema = z.enum(EFFECTS);

// Skema struktural sengaja mengizinkan semua effect; aturan keamanan ada di validateSteps()
// agar pesan error spesifik (FINAL_OUTSIDE_GATE, WRITE_WITHOUT_VERIFY), bukan "invalid union".
export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('nav'), path: nonEmpty, effect: EffectSchema }),
    z.object({
      op: z.literal('waitFor'),
      check: CheckSchema,
      timeoutMs: z.number().int().positive().optional(),
      effect: EffectSchema,
    }),
    z.object({ op: z.literal('fill'), target: TargetSchema, value: z.string(), effect: EffectSchema }),
    z.object({ op: z.literal('select'), target: TargetSchema, value: z.string(), effect: EffectSchema }),
    z.object({ op: z.literal('upload'), target: TargetSchema, file: nonEmpty, effect: EffectSchema }),
    z.object({
      op: z.literal('click'),
      target: TargetSchema,
      effect: EffectSchema,
      verify: CheckSchema.optional(),
      expectReload: z.boolean().optional(),
    }),
    z.object({ op: z.literal('verify'), check: CheckSchema, effect: EffectSchema }),
    z.object({
      op: z.literal('extract'),
      mode: z.enum(['table', 'text']),
      target: TargetSchema,
      into: nonEmpty,
      effect: EffectSchema,
    }),
    z.object({
      op: z.literal('gate.human'),
      message: nonEmpty,
      messageIf: z.object({ check: CheckSchema, message: nonEmpty }).optional(),
      until: CheckSchema,
      highlight: TargetSchema.optional(),
      effect: EffectSchema,
    }),
    z.object({ op: z.literal('forEach'), over: nonEmpty, steps: z.array(StepSchema).min(1) }),
    z.object({
      op: z.literal('branch'),
      when: CheckSchema,
      then: z.array(StepSchema).min(1),
      else: z.array(StepSchema).optional(),
    }),
  ]),
);

export type StepIssue = { code: ErrorCode; path: (string | number)[]; message: string };

function literalValues(step: Step): string[] {
  switch (step.op) {
    case 'fill':
    case 'select':
      return [step.value];
    case 'upload':
      return [step.file];
    case 'nav':
      return [step.path];
    default:
      return [];
  }
}

function checkRules(steps: Step[], base: (string | number)[], issues: StepIssue[]): void {
  steps.forEach((step, i) => {
    const path = [...base, i];
    if (step.op === 'forEach') return checkRules(step.steps, [...path, 'steps'], issues);
    if (step.op === 'branch') {
      checkRules(step.then, [...path, 'then'], issues);
      if (step.else) checkRules(step.else, [...path, 'else'], issues);
      return;
    }
    if (step.op === 'gate.human') {
      if (step.effect !== 'final') {
        issues.push({
          code: ErrorCode.STEP_SCHEMA_INVALID,
          path,
          message: 'gate.human selalu ber-effect "final"',
        });
      }
    } else if (step.effect === 'final') {
      issues.push({
        code: ErrorCode.FINAL_OUTSIDE_GATE,
        path,
        message: `langkah "${step.op}" tidak boleh ber-effect "final"; pengiriman akhir hanya lewat gate.human`,
      });
    }
    if (step.effect === 'write' && !(step.op === 'click' && step.verify)) {
      issues.push({
        code: ErrorCode.WRITE_WITHOUT_VERIFY,
        path,
        message: `langkah "${step.op}" ber-effect "write" wajib punya verify`,
      });
    }
    for (const value of literalValues(step)) {
      if (hasMalformedPlaceholder(value)) {
        issues.push({
          code: ErrorCode.PLACEHOLDER_MALFORMED,
          path,
          message: `placeholder rusak: "${value}"`,
        });
      }
    }
  });
}

export type ValidationResult = { ok: true; steps: Step[] } | { ok: false; issues: StepIssue[] };

/** Validasi struktur + aturan keamanan langkah adapter. */
export function validateSteps(input: unknown): ValidationResult {
  const parsed = z.array(StepSchema).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((iss) => ({
        code: ErrorCode.STEP_SCHEMA_INVALID,
        path: iss.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
        message: iss.message,
      })),
    };
  }
  const issues: StepIssue[] = [];
  checkRules(parsed.data, [], issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, steps: parsed.data };
}

export type Flow = { params?: z.ZodType; steps: Step[] };
export type AdapterDefinition = {
  id: string;
  origin: string;
  wilayah?: string[];
  flows: Record<string, Flow>;
};

/** Definisikan adapter; lempar UrusinError bila origin tidak resmi atau ada langkah melanggar aturan. */
export function defineAdapter<T extends AdapterDefinition>(def: T): T {
  if (!matchOfficialOrigin(def.origin).ok) {
    throw new UrusinError(
      ErrorCode.ADAPTER_ORIGIN_NOT_OFFICIAL,
      `origin adapter "${def.id}" tidak ada di registry domain resmi: ${def.origin}`,
    );
  }
  for (const [flowId, flow] of Object.entries(def.flows)) {
    const result = validateSteps(flow.steps);
    if (!result.ok) {
      const first = result.issues[0];
      throw new UrusinError(
        first?.code ?? ErrorCode.STEP_SCHEMA_INVALID,
        `flow "${def.id}.${flowId}" tidak valid: ${first?.message ?? 'tidak diketahui'}`,
        result.issues,
      );
    }
  }
  return def;
}

// ---------------------------------------------------------------------------
// Builder ringkas agar adapter terbaca seperti contoh di rencana.
// ---------------------------------------------------------------------------

export const byLabel = (value: string): Selector => ({ by: 'label', value });
export const byRole = (value: string, name?: string): Selector =>
  name === undefined ? { by: 'role', value } : { by: 'role', value, name };
export const byName = (value: string): Selector => ({ by: 'name', value });
export const byText = (value: string): Selector => ({ by: 'text', value });
export const css = (value: string): Selector => ({ by: 'css', value });

const toTarget = (t: Selector | Target): Target => (Array.isArray(t) ? t : [t]);

export const urlIncludes = (value: string): Check => ({ kind: 'urlIncludes', value });
export const textIncludes = (value: string): Check => ({ kind: 'textIncludes', value });
export const elementExists = (t: Selector | Target): Check => ({
  kind: 'elementExists',
  target: toTarget(t),
});
export const countIncreased = (t: Selector | Target): Check => ({
  kind: 'countIncreased',
  target: toTarget(t),
});

export const nav = (path: string): Step => ({ op: 'nav', path, effect: 'read' });
export const waitFor = (check: Check, timeoutMs?: number): Step =>
  timeoutMs === undefined
    ? { op: 'waitFor', check, effect: 'read' }
    : { op: 'waitFor', check, timeoutMs, effect: 'read' };
export const fill = (t: Selector | Target, value: string): Step => ({
  op: 'fill',
  target: toTarget(t),
  value,
  effect: 'input',
});
export const select = (t: Selector | Target, value: string): Step => ({
  op: 'select',
  target: toTarget(t),
  value,
  effect: 'input',
});
export const upload = (t: Selector | Target, file: string): Step => ({
  op: 'upload',
  target: toTarget(t),
  file,
  effect: 'input',
});
export const click = (
  t: Selector | Target,
  opts: { effect: 'read' | 'write' | 'final'; verify?: Check; expectReload?: boolean },
): Step => ({ op: 'click', target: toTarget(t), ...opts });
export const verify = (check: Check): Step => ({ op: 'verify', check, effect: 'read' });
export const extract = (mode: 'table' | 'text', t: Selector | Target, into: string): Step => ({
  op: 'extract',
  mode,
  target: toTarget(t),
  into,
  effect: 'read',
});
export const forEach = (over: string, steps: Step[]): Step => ({ op: 'forEach', over, steps });
export const branch = (when: Check, then: Step[], otherwise?: Step[]): Step =>
  otherwise === undefined ? { op: 'branch', when, then } : { op: 'branch', when, then, else: otherwise };
export const gate = {
  human: (
    message: string,
    opts: {
      until: Check;
      highlight?: Selector | Target;
      /** Pesan pengganti bila `check` benar saat gerbang dibuka (teks mengikuti kolom yang benar-benar ada). */
      messageIf?: { check: Check; message: string };
    },
  ): Step => ({
    op: 'gate.human',
    message,
    ...(opts.messageIf ? { messageIf: opts.messageIf } : {}),
    until: opts.until,
    ...(opts.highlight === undefined ? {} : { highlight: toTarget(opts.highlight) }),
    effect: 'final',
  }),
};
