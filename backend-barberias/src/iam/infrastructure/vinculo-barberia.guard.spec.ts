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
 *
 * F8 · el guard corría en CADA petición con tres consultas en serie (estado de
 * la sede, `usuario_roles` y, si no había rol, `cliente_barberias`). Ahora las
 * tres cosas viajan en UNA consulta cruda: la pertenencia se decide en la base
 * con dos `EXISTS` y el servicio solo lee la fila. Como el SQL va dentro de una
 * plantilla etiquetada, el mock lo RENDERIZA: los tests siguen fijando los
 * filtros (`ACTIVO` en las dos tablas) y no solo el resultado.
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

  /**
   * La consulta cruda tal y como la recibe Prisma: SQL con `?` en los huecos y
   * los valores por separado. Es lo que permite afirmar que el filtro ACTIVO va
   * en el SQL y no en memoria.
   */
  const consultaEjecutada = () => {
    const [cadenas, ...valores] = prisma.$queryRaw.mock.calls[0] as unknown as [
      string[],
      ...any[],
    ];

    let sql = cadenas[0];
    const parametros: unknown[] = [];
    valores.forEach((valor, i) => {
      // `Prisma.raw(...)` viaja como marcador `{ strings, values }`: es el nombre
      // calificado de la tabla (SQL), no un parámetro de la consulta.
      if (valor && typeof valor === 'object' && 'strings' in valor) {
        sql += valor.strings.join('') + cadenas[i + 1];
      } else {
        parametros.push(valor);
        sql += `?${cadenas[i + 1]}`;
      }
    });

    return { sql, valores: parametros };
  };

  /**
   * Filas que devolvería Postgres. `estado: null` simula una sede inexistente
   * (la consulta no devuelve fila).
   */
  const responderSede = (opts: { estado?: string | null; personal?: boolean; cliente?: boolean }) => {
    const estado = opts.estado === undefined ? 'ACTIVO' : opts.estado;
    if (estado === null) {
      prisma.$queryRaw.mockResolvedValue([]);
      return;
    }

    prisma.$queryRaw.mockResolvedValue([
      {
        estado,
        es_personal: opts.personal ?? false,
        es_cliente: opts.cliente ?? false,
      },
    ]);
  };

  beforeEach(() => {
    prisma = {
      // F8 · una única consulta: sede + personal + cliente.
      $queryRaw: vi.fn(),
      // Si el guard volviera a la versión de tres consultas, estas llamadas no
      // devuelven nada y los tests fallan: el contrato es "una sola ida a la base".
      usuarioRol: { findFirst: vi.fn() },
      clienteBarberia: { findFirst: vi.fn() },
      barberia: { findUnique: vi.fn() },
    };
    guard = new VinculoBarberiaGuard(prisma);
  });

  it('el ADMIN_BARBERIA de la sede entra por usuario_roles', async () => {
    responderSede({ personal: true });

    await expect(
      guard.canActivate(ctx({ user: cliente('adm-a', ['ADMIN_BARBERIA']), params: { shopId: SEDE_A } })),
    ).resolves.toBe(true);

    // Una sola consulta por petición, no tres.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('el BARBERO de la sede entra por usuario_roles', async () => {
    responderSede({ personal: true });

    await expect(
      guard.canActivate(ctx({ user: cliente('barb-a', ['BARBERO']), params: { shopId: SEDE_A } })),
    ).resolves.toBe(true);
  });

  it('el CLIENTE vinculado con fila ACTIVA entra', async () => {
    // El CLIENTE no tiene fila en `usuario_roles`: por eso el SQL devuelve
    // `es_personal = false` y es `es_cliente` lo que decide.
    responderSede({ cliente: true });

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-vinc'), params: { shopId: SEDE_A } })),
    ).resolves.toBe(true);

    // Lo que hace que pase es el ACTIVO: el filtro tiene que ir en el SQL.
    const { sql } = consultaEjecutada();
    expect(sql).toMatch(/cliente_barberias/);
    expect(sql).toMatch(/estado_vinculacion\s*=\s*'ACTIVO'/);
  });

  it('el CLIENTE sin fila en cliente_barberias recibe 403', async () => {
    responderSede({ personal: false, cliente: false });

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-suelto'), params: { shopId: SEDE_A } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un vínculo SUSPENDIDO NO habilita: la consulta exige ACTIVO', async () => {
    // La base no devuelve la fila como ACTIVA: el guard no puede habilitar.
    responderSede({ personal: false, cliente: false });

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-susp'), params: { shopId: SEDE_B } })),
    ).rejects.toThrow(ForbiddenException);

    const { sql } = consultaEjecutada();
    // Los dos filtros de estado, en el SQL: sin ellos, "existe fila" daría acceso.
    expect(sql).toMatch(/ur\.estado\s*=\s*'ACTIVO'/);
    expect(sql).toMatch(/cb\.estado_vinculacion\s*=\s*'ACTIVO'/);
  });

  it('la sede y el usuario viajan como parámetros, no pegados al SQL', async () => {
    responderSede({ personal: false, cliente: true });

    await guard.canActivate(ctx({ user: cliente('cli-param'), params: { shopId: SEDE_A } }));

    const { sql, valores } = consultaEjecutada();
    // Nada de valores pegados al SQL: van por huecos parametrizados.
    expect(sql).not.toContain(SEDE_A);
    expect(sql).not.toContain('cli-param');
    expect(valores).toEqual(['cli-param', 'cli-param', SEDE_A]);
  });

  it('el CLIENTE vinculado a A no lee el catálogo de B', async () => {
    prisma.$queryRaw.mockImplementation(async (_cadenas: string[], ...valores: unknown[]) =>
      valores.includes(SEDE_A)
        ? [{ estado: 'ACTIVO', es_personal: false, es_cliente: true }]
        : [{ estado: 'ACTIVO', es_personal: false, es_cliente: false }],
    );

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), params: { shopId: SEDE_A } })),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), params: { shopId: SEDE_B } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el ADMINISTRADOR global conserva el bypass: ve cualquier sede sin vínculo', async () => {
    await expect(
      guard.canActivate(ctx({ user: cliente('adm-global', ['ADMINISTRADOR']), params: { shopId: SEDE_B } })),
    ).resolves.toBe(true);

    // El bypass es total: ni consulta la base.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('I-01 · una sede SUSPENDIDA deniega aunque el vínculo esté ACTIVO', async () => {
    // El vínculo sigue ACTIVO en las dos tablas: lo que cambió es la sede. Sin
    // esta comprobación, el personal seguiría operando sobre una sede suspendida.
    responderSede({ estado: 'INACTIVO', personal: true, cliente: true });

    await expect(
      guard.canActivate(ctx({ user: cliente('adm-a', ['ADMIN_BARBERIA']), params: { shopId: SEDE_A } })),
    ).rejects.toThrow(/está suspendida/);
  });

  it('I-01 · una sede SUSPENDIDA deniega también al CLIENTE vinculado', async () => {
    responderSede({ estado: 'INACTIVO', cliente: true });

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-vinc'), params: { shopId: SEDE_A } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('I-01 · una sede inexistente deniega (no se filtra que no existe)', async () => {
    responderSede({ estado: null });

    await expect(
      guard.canActivate(ctx({ user: cliente('cli-vinc'), params: { shopId: SEDE_A } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('I-01 · el ADMINISTRADOR global no consulta el estado de la sede (bypass D05)', async () => {
    responderSede({ estado: 'INACTIVO' });

    await expect(
      guard.canActivate(ctx({ user: cliente('adm-global', ['ADMINISTRADOR']), params: { shopId: SEDE_A } })),
    ).resolves.toBe(true);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sin sesión no pasa, aunque las tablas digan que sí', async () => {
    responderSede({ personal: true });

    await expect(guard.canActivate(ctx({ user: null, params: { shopId: SEDE_A } }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sin sede no decide: deja que la ruta conteste 400 más abajo', async () => {
    // Sin sede el decorador `@CurrentBarberiaId` responde 400. Si el guard
    // denegara aquí, un cliente sin cabecera recibiría 403 en vez de 400 y el
    // mensaje de "no indicaste la sede" dejaría de ser cierto.
    await expect(guard.canActivate(ctx({ user: cliente('cli-a') }))).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('la sede sale de la misma cadena que el decorador: ruta > query', async () => {
    responderSede({ cliente: true });

    // Con las dos fuentes que quedan, `params` manda: es la ruta la que acota la sede.
    await expect(
      guard.canActivate(
        ctx({
          user: cliente('cli-a'),
          params: { shopId: SEDE_A },
          query: { shopId: SEDE_B },
        }),
      ),
    ).resolves.toBe(true);

    expect(consultaEjecutada().valores).toContain(SEDE_A);
    expect(consultaEjecutada().valores).not.toContain(SEDE_B);
  });

  it('la cabecera x-barberia-id ya NO es fuente de sede (Punto 5.3)', async () => {
    // Sin ruta ni query, la cabecera ya no acota: el guard no busca vínculo y
    // la ruta contesta 400 con el mensaje de "no indicaste la sede".
    await expect(guard.canActivate(ctx({ user: cliente('cli-a'), header: SEDE_A }))).resolves.toBe(
      true,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('una sede que no es UUID no cuenta como sede', async () => {
    // `resolverBarberiaId` devuelve null para lo que no es UUID, así que el
    // guard no busca vínculo: la ruta contestará 400.
    await expect(
      guard.canActivate(ctx({ user: cliente('cli-a'), params: { shopId: 'no-es-uuid' } })),
    ).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
