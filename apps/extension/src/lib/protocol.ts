import type { Step } from '@urusin/core';

/** Protokol pesan web app <-> ekstensi (rencana §3.5 butir 4-5). */
export const PROTOCOL_VERSION = 1;

export type ExecutionRequest = {
  executionId: string;
  /** Origin dasar untuk langkah `nav` (path relatif). */
  origin: string;
  steps: Step[];
};

export type WebMessage =
  | { type: 'pair'; nonce: string }
  | { type: 'ping'; nonce: string }
  | { type: 'execute'; nonce: string; request: ExecutionRequest }
  | { type: 'status'; nonce: string };

export type ErrorReply = { ok: false; code: string; message: string };

export const err = (code: string, message: string): ErrorReply => ({ ok: false, code, message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validasi bentuk pesan. Isi `steps` divalidasi terpisah oleh `validateSteps` dari core. */
export function parseWebMessage(raw: unknown): WebMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || typeof raw.nonce !== 'string') return null;
  switch (raw.type) {
    case 'pair':
    case 'ping':
    case 'status':
      return { type: raw.type, nonce: raw.nonce };
    case 'execute': {
      const req = raw.request;
      if (
        !isRecord(req) ||
        typeof req.executionId !== 'string' ||
        typeof req.origin !== 'string' ||
        !Array.isArray(req.steps)
      ) {
        return null;
      }
      return {
        type: 'execute',
        nonce: raw.nonce,
        request: { executionId: req.executionId, origin: req.origin, steps: req.steps as Step[] },
      };
    }
    default:
      return null;
  }
}
