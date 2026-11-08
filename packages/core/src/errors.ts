/** Kode error yang dipakai lintas paket (server, ekstensi, adapter). Stabil: jangan ganti nilai. */
export const ErrorCode = {
  // Registry domain resmi
  URL_INVALID: 'URL_INVALID',
  URL_NOT_HTTPS: 'URL_NOT_HTTPS',
  URL_HAS_USERINFO: 'URL_HAS_USERINFO',
  URL_NONSTANDARD_PORT: 'URL_NONSTANDARD_PORT',
  URL_PUNYCODE: 'URL_PUNYCODE',
  DOMAIN_NOT_OFFICIAL: 'DOMAIN_NOT_OFFICIAL',
  // Placeholder & PII
  PLACEHOLDER_IN_LLM_PARAM: 'PLACEHOLDER_IN_LLM_PARAM',
  PII_IN_LLM_PARAM: 'PII_IN_LLM_PARAM',
  PLACEHOLDER_MALFORMED: 'PLACEHOLDER_MALFORMED',
  // Step DSL
  STEP_SCHEMA_INVALID: 'STEP_SCHEMA_INVALID',
  FINAL_OUTSIDE_GATE: 'FINAL_OUTSIDE_GATE',
  WRITE_WITHOUT_VERIFY: 'WRITE_WITHOUT_VERIFY',
  ADAPTER_ORIGIN_NOT_OFFICIAL: 'ADAPTER_ORIGIN_NOT_OFFICIAL',
  // Runtime (dipakai executor/harness)
  ADAPTER_DRIFT: 'ADAPTER_DRIFT',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class UrusinError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'UrusinError';
    this.code = code;
    this.details = details;
  }
}

export function isUrusinError(value: unknown): value is UrusinError {
  return value instanceof UrusinError;
}
