import { describe, it, expect, vi } from 'vitest';
import { crearPurgador } from './cache-purger.js';

/**
 * La purga por prefijo contra Redis NO puede leer valores: el keyspace está
 * compartido con BullMQ y el `iterator` de Keyv revienta al deserializar sus
 * claves. Estas pruebas fijan las dos vías (Redis con `SCAN MATCH` y memoria).
 */
describe('crearPurgador (invalidación por prefijo)', () => {
  it('en Redis filtra con SCAN MATCH y borra por lotes, sin leer valores', async () => {
    const paginas = [
      { cursor: 17, keys: ['analytics:shop:s1:all-all'] },
      { cursor: 0, keys: ['analytics:shop:s1:2026-10-01-2026-10-31'] },
    ];
    const scan = vi.fn(async () => paginas.shift()!);
    const del = vi.fn(async () => 1);
    const mget = vi.fn();

    const nodo = { scan, del, mget };
    const store = {
      store: { getMasterNodes: async () => [nodo] },
      // Si el purgador tocara el Keyv, esta prueba fallaría: no debe hacerlo.
      iterator: () => {
        throw new Error('no debe iterar el Keyv con Redis');
      },
      deleteMany: vi.fn(),
    };

    const purgador = crearPurgador(store as unknown as Parameters<typeof crearPurgador>[0]);
    const borradas = await purgador.purgarPorPrefijo('analytics:shop:s1:');

    expect(borradas).toBe(2);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledWith('0', {
      MATCH: 'analytics:shop:s1:*',
      COUNT: 200,
      TYPE: 'string',
    });
    // El segundo `SCAN` continúa desde el cursor devuelto por el primero.
    expect(scan).toHaveBeenLastCalledWith('17', expect.objectContaining({ MATCH: 'analytics:shop:s1:*' }));
    expect(del).toHaveBeenNthCalledWith(1, ['analytics:shop:s1:all-all']);
    expect(del).toHaveBeenNthCalledWith(2, ['analytics:shop:s1:2026-10-01-2026-10-31']);
    expect(mget).not.toHaveBeenCalled();
    expect(store.deleteMany).not.toHaveBeenCalled();
  });

  it('no escribe nada cuando el prefijo no tiene claves', async () => {
    const scan = vi.fn(async () => ({ cursor: 0, keys: [] as string[] }));
    const del = vi.fn();
    const store = { store: { getMasterNodes: async () => [{ scan, del }] } };

    const purgador = crearPurgador(store as unknown as Parameters<typeof crearPurgador>[0]);

    await expect(purgador.purgarPorPrefijo('analytics:overview:')).resolves.toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it('sin Redis itera el store en memoria y borra solo el prefijo pedido', async () => {
    const restantes = new Set([
      'analytics:shop:s1:all-all',
      'analytics:shop:s2:all-all',
      'otra:clave',
    ]);
    const store = {
      iterator: async function* () {
        for (const clave of restantes) yield [clave, { valor: 1 }];
      },
      deleteMany: vi.fn(async (claves: string[]) => {
        claves.forEach((c) => restantes.delete(c));
        return claves.map(() => true);
      }),
    };

    const purgador = crearPurgador(store as unknown as Parameters<typeof crearPurgador>[0]);

    await expect(purgador.purgarPorPrefijo('analytics:shop:s1:')).resolves.toBe(1);
    expect(store.deleteMany).toHaveBeenCalledWith(['analytics:shop:s1:all-all']);
    expect(restantes.has('analytics:shop:s2:all-all')).toBe(true);
  });

  it('si Redis no entrega nodos, propaga el fallo en vez de fingir que purgó', async () => {
    const store = {
      store: {
        getMasterNodes: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
      iterator: async function* () {
        yield ['analytics:shop:s1:all-all', {}];
      },
      deleteMany: vi.fn(),
    };

    const purgador = crearPurgador(store as unknown as Parameters<typeof crearPurgador>[0]);

    await expect(purgador.purgarPorPrefijo('analytics:shop:s1:')).resolves.toBe(0);
    expect(store.deleteMany).not.toHaveBeenCalled();
  });
});
