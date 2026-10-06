import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { VinculoBarberiaGuard } from './vinculo-barberia.guard.js';

/**
 * E1-06 · paso 5: el catálogo es privado hasta el vínculo.
 *
 * Estos tests fijan QUIÉN pasa el filtro y con qué fila. El e2e comprueba el
 * efecto observable (403/200 por HTTP); aquí se comprueba la regla, incluido el
 * detalle de que un vínculo `SUSPENDIDO` no habilita: si el filtro se quedara
 * solo en "existe fila", el e2e del caso suspendido caería y el defecto volvería
 * sin que nadie lo note.
 */
describe('VinculoBarberiaGuard · el catálogo exige vínculo (E1-06 paso 5)', () => {
  let guard: VinculoBarberiaGuard;
  let prisma: any;

  const SEDE_A = '11111111-1111-4111-8111-111111111111';
  const SEDE_B = '22222222-2222-4222-8222-222222222222';

  /** Request mínimo con lo que el guard lee: `user` y las tres fuentes de sede. */
  const ctx = (opts: {
    user?: { id: string; correo: string; roles: string[] } | null;
    header?: string;
    params?: Record<string, string>;
    query?: Record<string, string>;
  }) => {
    const request: any = { headers: {}, params: {}, query: {} };
    if (opts.header) request.headers['x-barberia-id'] = opts.header;
    if (opts.params) request.params = opts.params;
    if (opts.query) request.query = opts.query;
    if ('user' in opts) request.user = opts.user;
    return { switchToHttp: () => ({ getRequest: () => request }) } as any;
  };

  const cliente = (id: string, roles = ['CLIENTE']) => ({ id, correo: `${id}@test.com`, roles });

  beforeEach(() => {
    // `usuarioRol` responde al personal, `clienteBarberia` al CLIENTE. El mock
    // separa las dos tablas para que cada test exprese la regla y no el mock.
    prisma = {
      usuarioRol: {
        findFirst: vi.fn(async ({ where }: any) => ({ id: 'rol-1' })),
      },
      clienteBarberia: {
        findFirst: vi.fn(async ({ where }: any) => ({ id: 'vinculo-1' })),
      },
    };
    guard = new VinculoBarberiaGuard(prisma);
  });

  it('el ADMIN_BARBERIA de la sede entra por usuario_roles', async () => {
    await expect(
      guard.canActivate(ctx({ user: cliente('adm-a', ['ADMIN_BARBERIA']), header: SEDE_A })),
    ).resolves.toBe(true);
    // No hay que mirar `cliente_barberias`: el personal entra por rol.
    expect(prisma.clienteBarberia.findFirst).not.toHaveBeenCalled();
  });

  it('el BARBERO de la sede entra por usuario_roles', async () => {
    await expect(
      guard.canActivate(ctx({ user: cliente('barb-a', ['BARBERO']), header: SEDE_A })),
    ).resolves.toBe(true);
  });

  it('el CLIENTE vinculado con fila ACTIVA entra', async () => {
    // El CLIENTE no tiene fila en `usuario_roles`: por eso el mock responde null
    // ahí y es `cliente_barberias` la tabla que decide.
    prisma.usuarioRol.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-vinc'), header: SEDE_A })),
    ).resolves.toBe(true);

    // Lo que hace que pase es el ACTIVO: si el filtro desapareciera, el e2e del
    // vínculo suspendido se caería, pero esta aserción lo detecta antes.
    expect(prisma.clienteBarberia.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuarioId: 'cli-vinc', barberiaId: SEDE_A, estadoVinculacion: 'ACTIVO' },
      }),
    );
  });

  it('el CLIENTE sin fila en cliente_barberias recibe 403', async () => {
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.clienteBarberia.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-suelto'), header: SEDE_A })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un vínculo SUSPENDIDO NO habilita: la consulta exige ACTIVO', async () => {
    // `prisma` responde como lo haría la base si la fila existiera pero no
    // estuviera ACTIVA: el filtro va en el `where`, así que no la encuentra.
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.clienteBarberia.findFirst.mockImplementation(async ({ where }: any) =>
      where.estadoVinculacion === 'ACTIVO' ? null : { id: 'vinculo-suspendido' },
    );

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-susp'), header: SEDE_B })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el CLIENTE vinculado a A no lee el catálogo de B', async () => {
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.clienteBarberia.findFirst.mockImplementation(async ({ where }: any) =>
      where.barberiaId === SEDE_A ? { id: 'vinculo-a' } : null,
    );

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), header: SEDE_A })),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), header: SEDE_B })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el ADMINISTRADOR global conserva el bypass: ve cualquier sede sin vínculo', async () => {
    await expect(
      guard.canActivate(ctx({ user: cliente('adm-global', ['ADMINISTRADOR']), header: SEDE_B })),
    ).resolves.toBe(true);

    // El bypass es total: ni consulta las tablas de pertenencia.
    expect(prisma.usuarioRol.findFirst).not.toHaveBeenCalled();
    expect(prisma.clienteBarberia.findFirst).not.toHaveBeenCalled();
  });

  it('sin sesión no pasa, aunque las tablas digan que sí', async () => {
    await expect(guard.canActivate(ctx({ user: null, header: SEDE_A }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('sin sede no decide: deja que la ruta conteste 400 más abajo', async () => {
    // Sin sede el decorador `@CurrentBarberiaId` responde 400. Si el guard
    // denegara aquí, un cliente sin cabecera recibiría 403 en vez de 400 y el
    // mensaje de "no indicaste la sede" dejaría de ser cierto.
    await expect(guard.canActivate(ctx({ user: cliente('cli-a') }))).resolves.toBe(true);
    expect(prisma.clienteBarberia.findFirst).not.toHaveBeenCalled();
  });

  it('la sede sale de la misma cadena que el decorador: ruta > cabecera > query', async () => {
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.clienteBarberia.findFirst.mockImplementation(async ({ where }: any) =>
      where.barberiaId === SEDE_A ? { id: 'v' } : null,
    );

    // Con las tres fuentes, `params` manda: es la ruta la que acota la sede.
    await expect(
      guard.canActivate(
        ctx({
          user: cliente('cli-a'),
          params: { barberiaId: SEDE_A },
          header: SEDE_B,
          query: { barberiaId: SEDE_B },
        }),
      ),
    ).resolves.toBe(true);
    expect(prisma.clienteBarberia.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barberiaId: SEDE_A }) }),
    );
  });

  it('una cabecera que no es UUID no cuenta como sede', async () => {
    // `resolverBarberiaId` devuelve null para lo que no es UUID, así que el
    // guard no busca vínculo: la ruta contestará 400.
    prisma.clienteBarberia.findFirst.mockClear();
    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), header: 'no-es-uuid' })),
    ).resolves.toBe(true);
    expect(prisma.clienteBarberia.findFirst).not.toHaveBeenCalled();
  });
});