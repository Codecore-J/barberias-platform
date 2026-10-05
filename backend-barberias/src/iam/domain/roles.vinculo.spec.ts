import { describe, it, expect } from 'vitest';
import { perteneceABarberia } from './roles.js';

/**
 * E1-06 · parte 3. `perteneceABarberia` es la pieza que cierra la lectura
 * cross-tenant de `/agenda/disponibilidad`: el guard y el decorador comprueban
 * el ROL, y el rol `CLIENTE` es GLOBAL con `barberia_id` nulo, o sea que
 * `alcanceCumple` lo admitía contra cualquier sede. Aquí la pertenencia se
 * resuelve contra las dos tablas que de verdad la expresan.
 */
describe('perteneceABarberia (E1-06)', () => {
  function prismaMock(usuarioRol: unknown, clienteBarberia: unknown) {
    return {
      usuarioRol: { findFirst: async () => usuarioRol },
      clienteBarberia: { findFirst: async () => clienteBarberia },
    } as any;
  }

  it('el BARBERO pertenece por su fila en usuario_roles de ESA sede', async () => {
    const prisma = prismaMock({ id: 'rol-1' }, null);
    await expect(perteneceABarberia(prisma, 'barbero-1', 'sede-a')).resolves.toBe(true);
  });

  it('el CLIENTE pertenece por su fila en cliente_barberias', async () => {
    const prisma = prismaMock(null, { id: 'vinculo-1' });
    await expect(perteneceABarberia(prisma, 'cliente-1', 'sede-a')).resolves.toBe(true);
  });

  it('un usuario sin ninguna de las dos filas NO pertenece: es el caso cross-tenant', async () => {
    const prisma = prismaMock(null, null);
    await expect(perteneceABarberia(prisma, 'cliente-1', 'sede-ajena')).resolves.toBe(false);
  });

  it('pertenece a la suya y no a la ajena: la sede que se consulta es parte de la consulta', async () => {
    // El mock solo devuelve fila cuando la sede consultada es la del usuario.
    const prisma = {
      usuarioRol: {
        findFirst: async ({ where }: any) =>
          where.barberiaId === 'sede-a' ? { id: 'rol-1' } : null,
      },
      clienteBarberia: { findFirst: async () => null },
    } as any;

    await expect(perteneceABarberia(prisma, 'barbero-1', 'sede-a')).resolves.toBe(true);
    await expect(perteneceABarberia(prisma, 'barbero-1', 'sede-b')).resolves.toBe(false);
  });

  it('no consulta cliente_barberias cuando ya encontró un rol (atajo y menos carga)', async () => {
    let consultasVinculo = 0;
    const prisma = {
      usuarioRol: { findFirst: async () => ({ id: 'rol-1' }) },
      clienteBarberia: {
        findFirst: async () => {
          consultasVinculo += 1;
          return null;
        },
      },
    } as any;

    await expect(perteneceABarberia(prisma, 'barbero-1', 'sede-a')).resolves.toBe(true);
    expect(consultasVinculo).toBe(0);
  });
});