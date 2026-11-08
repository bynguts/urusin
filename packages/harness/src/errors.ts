/** Error domain harness. `status` = kode HTTP yang dipakai endpoint. */
export class HarnessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}

/** CAS gagal: `version` sudah berubah. Klien mengantre dan mengirim ulang. */
export class ConflictError extends HarnessError {
  constructor(message = 'urusan berubah oleh permintaan lain (version tidak cocok)') {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class TurnInProgressError extends HarnessError {
  constructor() {
    super('TURN_IN_PROGRESS', 'masih ada turn yang berjalan untuk urusan ini', 409);
    this.name = 'TurnInProgressError';
  }
}

export class IllegalTransitionError extends HarnessError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super('ILLEGAL_TRANSITION', `transisi ${from} → ${to} tidak diizinkan`, 422);
    this.name = 'IllegalTransitionError';
  }
}

export class NotFoundError extends HarnessError {
  constructor(what = 'urusan') {
    super('NOT_FOUND', `${what} tidak ditemukan`, 404);
    this.name = 'NotFoundError';
  }
}

export class TerminalStateError extends HarnessError {
  constructor(state: string) {
    super('TERMINAL_STATE', `urusan sudah berakhir (${state})`, 409);
    this.name = 'TerminalStateError';
  }
}
