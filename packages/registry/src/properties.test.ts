import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RegistryError, kodeFromNik, routeByKode, routeByNik } from './index.js';

const digits = (n: number) => fc.stringMatching(new RegExp(`^[0-9]{${n}}$`));

describe('property: router prefiks NIK', () => {
  it('tidak pernah melempar selain RegistryError untuk string sembarang', () => {
    for (const fn of [routeByNik, routeByKode, kodeFromNik]) {
      fc.assert(
        fc.property(fc.string({ maxLength: 40 }), (s) => {
          try {
            fn(s);
          } catch (e) {
            expect(e).toBeInstanceOf(RegistryError);
          }
        }),
      );
    }
  });

  it('pesan error tidak pernah memuat masukan', () => {
    for (const fn of [routeByNik, routeByKode, kodeFromNik]) {
      fc.assert(
        fc.property(fc.string({ minLength: 5, maxLength: 40 }), (s) => {
          try {
            fn(s);
          } catch (e) {
            expect((e as Error).message).not.toContain(s);
          }
        }),
      );
    }
  });

  it('NIK 16 digit selalu menghasilkan rute dengan kode = 4 digit pertama, tanpa membawa NIK', () => {
    fc.assert(
      fc.property(digits(16), (nik) => {
        const r = routeByNik(nik);
        expect(r.kodeKabKota).toBe(nik.slice(0, 4));
        expect(r.entry.kodeKabKota).toBe(nik.slice(0, 4));
        expect(JSON.stringify(r)).not.toContain(nik);
      }),
    );
  });

  it('panjang selain 16 digit atau karakter non-digit ditolak dengan NIK_INVALID', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .integer({ min: 0, max: 40 })
            .filter((n) => n !== 16)
            .chain((n) => digits(n)),
          digits(15).map((s) => `${s}x`),
          digits(16).map((s) => ` ${s}`),
        ),
        (s) => {
          let caught: unknown;
          try {
            routeByNik(s);
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(RegistryError);
          expect((caught as RegistryError).code).toBe('NIK_INVALID');
        },
      ),
    );
  });
});
