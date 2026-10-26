import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsCacheListener } from './analytics-cache.listener.js';

/** Store mínimo: `iterator` + `deleteMany` son lo único que usa el listener. */
const crearStore = (claves: string[]) => {
  const restantes = new Set(claves);
  return {
    restantes,
    iterator: async function* () {
      for (const clave of [...restantes]) {
        yield [clave, { valor: 1 }];
      }
    },
    deleteMany: vi.fn(async (keys: string[]) => {
      keys.forEach((k) => restantes.delete(k));
      return keys.map(() => true);
    }),
  };
};

describe('AnalyticsCacheListener (Paso 14)', () => {
  let listener: AnalyticsCacheListener;
  let store: ReturnType<typeof crearStore>;

  beforeEach(() => {
    store = crearStore([]);
    listener = new AnalyticsCacheListener(store as any);
  });

  it('purga solo las claves de la sede del evento', async () => {
    store = crearStore([
      'analytics:shop:shop-1:2026-10-01-2026-10-31',
      'analytics:shop:shop-1:all-all',
      'analytics:shop:shop-2:2026-10-01-2026-10-31',
      'otra:clave',
    ]);
    listener = new AnalyticsCacheListener(store as any);

    await listener.alOcurrirEventoDeReserva({ barberiaId: 'shop-1' });

    expect(store.deleteMany).toHaveBeenCalledWith([
      'analytics:shop:shop-1:2026-10-01-2026-10-31',
      'analytics:shop:shop-1:all-all',
    ]);
    expect(store.restantes.has('analytics:shop:shop-2:2026-10-01-2026-10-31')).toBe(true);
    expect(store.restantes.has('analytics:shop:shop-1:all-all')).toBe(false);
  });

  it('purga también el consolidado multisede, que agrega todas las sedes', async () => {
    store = crearStore([
      'analytics:shop:shop-1:all-all',
      'analytics:overview:u1:all-all',
      'analytics:overview:global:all-all',
    ]);
    listener = new AnalyticsCacheListener(store as any);

    await listener.alOcurrirEventoDeReserva({ barberiaId: 'shop-1' });

    expect(store.restantes.size).toBe(0);
  });

  it('no escribe nada si el prefijo no tiene entradas', async () => {
    store = crearStore(['analytics:overview:u1:all-all']);
    listener = new AnalyticsCacheListener(store as any);

    // La sede no tiene nada cacheado: solo se purga el overview.
    await listener.alOcurrirEventoDeReserva({ barberiaId: 'shop-9' });

    expect(store.deleteMany).toHaveBeenCalledTimes(1);
    expect(store.deleteMany).toHaveBeenCalledWith(['analytics:overview:u1:all-all']);
  });

  it('ignora eventos sin barberiaId', async () => {
    store = crearStore(['analytics:shop:shop-1:all-all']);
    listener = new AnalyticsCacheListener(store as any);

    await listener.alOcurrirEventoDeReserva({});

    expect(store.deleteMany).not.toHaveBeenCalled();
  });

  it('nunca deja escapar el error del store', async () => {
    const roto = {
      iterator: async function* () {
        throw new Error('redis caído');
      },
      deleteMany: vi.fn(),
    };
    listener = new AnalyticsCacheListener(roto as any);

    await expect(listener.alOcurrirEventoDeReserva({ barberiaId: 'shop-1' })).resolves.toBeUndefined();
  });
});
