import { describe, expect, it } from 'vitest';
import { ENCOLADO_TIMEOUT_MS, encolarConLimite } from './encolado-seguro.js';

/**
 * H62 · Contrato del encolado best-effort.
 *
 * Los dos modos de fallo medidos contra BullMQ con `maxRetriesPerRequest: null`
 * (el que monta `app.module.ts`) se prueban aquí por separado, porque NO se
 * comportan igual:
 *  - Redis responde con error (cuota agotada de Upstash): `add` RECHAZA.
 *  - Redis no responde: `add` NI resuelve NI rechaza (se queda en la cola
 *    offline de ioredis). Medido contra un puerto cerrado: colgado hasta que lo
 *    mató un `timeout 20`.
 */
describe('H62 · encolarConLimite', () => {
  it('VERDE: un encolado que resuelve devuelve ok con su valor', async () => {
    const resultado = await encolarConLimite(async () => 'job-1');

    expect(resultado).toEqual({ ok: true, valor: 'job-1', encoladoEnMs: expect.any(Number) });
  });

  it('VERDE: un encolado que RECHAZA (cuota agotada) devuelve ok=false con el motivo, sin lanzar', async () => {
    const resultado = await encolarConLimite(async () => {
      throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500001');
    });

    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({
      motivo: expect.stringContaining('max requests limit exceeded'),
    });
  });

  it('ROJO: un encolado que se quedaría colgado corta por tiempo y no espera sin fin', async () => {
    const inicio = Date.now();

    const resultado = await encolarConLimite(() => new Promise(() => {}), 50);

    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({ motivo: 'la cola no respondió en 50 ms' });
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it('VERDE: nunca lanza aunque el error venga como valor no-Error', async () => {
    const resultado = await encolarConLimite(async () => {
      throw 'ECONNREFUSED';
    });

    expect(resultado).toMatchObject({ ok: false, motivo: 'ECONNREFUSED' });
  });

  it('el techo por defecto es finito y del orden de segundos (no de minutos)', () => {
    expect(ENCOLADO_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ENCOLADO_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
