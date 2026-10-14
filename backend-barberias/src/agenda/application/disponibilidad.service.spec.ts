import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { DisponibilidadService } from './disponibilidad.service.js';

/**
 * E1-06 · parte 3: `calcularDisponibilidadDeSolicitante` es la puerta que
 * impide leer la agenda de una sede ajena.
 *
 * Antes, el guard y el decorador solo miraban el ROL, y el `CLIENTE` es GLOBAL
 * con `barberia_id` nulo: `alcanceCumple` lo dejaba pasar contra cualquier sede.
 * Estos tests fijan que la pertenencia se exige de verdad.
 */
describe('DisponibilidadService · calcularDisponibilidadDeSolicitante (E1-06)', () => {
  let service: DisponibilidadService;
  let prisma: any;

  beforeEach(() => {
    // `esAdministradorGlobalPorId` busca ADMINISTRADOR; `perteneceABarberia`
    // busca usuario_roles y cliente_barberias. El mock separa ambos por la
    // tabla que se consulta para que el test exprese la regla y no el mock.
    prisma = {
      // E2-04: la disponibilidad lee la zona horaria de la sede.
      barberia: {
        findUnique: vi.fn(async () => ({ zonaHoraria: 'America/Santo_Domingo' })),
      },
      usuarioRol: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where.rol?.nombre === 'ADMINISTRADOR') return null;
          return where.barberiaId === 'sede-propia' ? { id: 'rol-1' } : null;
        }),
      },
      clienteBarberia: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.barberiaId === 'sede-propia' ? { id: 'vinculo-1' } : null,
        ),
      },
      horario: { findFirst: vi.fn(async () => null) },
      excepcionHorario: { findFirst: vi.fn(async () => null) },
    };
    service = new DisponibilidadService(prisma);
  });

  const solicitud = (barberiaId: string) => ({
    barberiaId,
    fecha: new Date('2026-10-05T00:00:00Z'),
    duracionTotal: 30,
    margenRequerido: 0,
  });

  it('permite consultar cuando el solicitante tiene rol en esa sede', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-propia'), 'barbero-1'),
    ).resolves.toEqual([]);
  });

  it('permite consultar cuando el solicitante está vinculado por cliente_barberias', async () => {
    // El mock de usuario_roles devuelve null para cualquier sede que no sea
    // 'sede-propia'; aquí la pertenencia llega por la segunda tabla.
    prisma.clienteBarberia.findFirst = vi.fn(async () => ({ id: 'vinculo-1' }));

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).resolves.toEqual([]);
  });

  it('RECHAZA con 403 a un cliente que pide la disponibilidad de otra sede', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el 403 dice que no pertenece, no que el rol es incorrecto', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).rejects.toThrow(/No perteneces a esta barbería/);
  });

  it('permite al ADMINISTRADOR global sin vínculo: es transversal (D05)', async () => {
    prisma.usuarioRol.findFirst = vi.fn(async ({ where }: any) =>
      where.rol?.nombre === 'ADMINISTRADOR' ? { id: 'rol-admin' } : null,
    );

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'admin-1'),
    ).resolves.toEqual([]);
  });
});

/**
 * P-SD-4 · sede suspendida: la disponibilidad deja de existir para una sede
 * `INACTIVO`.
 *
 * Antes el estado de la sede solo lo leía `vincularCliente`: una sede suspendida
 * seguía devolviendo huecos y el wizard seguía permitiendo reservar. Aquí se
 * fija que las tres puertas de lectura de disponibilidad lo rechazan con 422
 * `SEDE_INACTIVA` (D40), y que el rechazo NO se cuela antes de la pertenencia:
 * un cliente de otra sede no puede usar el 422 para sondear suspensiones.
 */
describe('DisponibilidadService · sede INACTIVO (P-SD-4)', () => {
  let service: DisponibilidadService;
  let prisma: any;

  /** Contrato D40: el cuerpo del error lleva `codigo`. */
  async function capturarError(promesa: Promise<unknown>) {
    try {
      await promesa;
    } catch (error: any) {
      const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
      return {
        status: error?.getStatus?.() ?? respuesta.statusCode,
        codigo: respuesta.codigo,
        error,
      };
    }
    throw new Error('Se esperaba una excepción y la promesa se resolvió.');
  }

  beforeEach(() => {
    prisma = {
      // El mock separa la fila por qué se le pide: el estado solo se lee en la
      // guarda nueva, la zona en `datosDelDia`.
      barberia: {
        findUnique: vi.fn(async ({ select }: any) =>
          select?.estado ? { estado: 'INACTIVO' } : { zonaHoraria: 'America/Santo_Domingo' },
        ),
      },
      usuarioRol: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.rol?.nombre === 'ADMINISTRADOR' ? null : { id: 'rol-1' },
        ),
      },
      clienteBarberia: { findFirst: vi.fn(async () => ({ id: 'vinculo-1' })) },
      configuracionBarberia: { findUnique: vi.fn(async () => null) },
      horario: { findFirst: vi.fn(async () => null) },
      excepcionHorario: { findFirst: vi.fn(async () => null) },
    };
    service = new DisponibilidadService(prisma);
  });

  const solicitud = {
    barberiaId: 'sede-suspendida',
    fecha: '2026-10-05',
    duracionTotal: 30,
    margenRequerido: 0,
  };

  it('GET de disponibilidad sobre una sede INACTIVO responde 422 SEDE_INACTIVA', async () => {
    const { status, codigo, error } = await capturarError(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-1'),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
    expect(error).toBeInstanceOf(UnprocessableEntityException);
  });

  it('los huecos de una sede INACTIVO también se rechazan (no devuelven [])', async () => {
    const { status, codigo } = await capturarError(
      service.huecosDeLaSede('sede-suspendida', 'cliente-1', {
        fecha: '2026-10-05',
        duracionTotal: 30,
        participantes: 1,
      }),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
  });

  it('las alternativas de una sede INACTIVO también se rechazan', async () => {
    const { status, codigo } = await capturarError(
      service.buscarAlternativasDeSolicitante(
        { ...solicitud, duracionRequeridaMinutos: 30 },
        'cliente-1',
      ),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
  });

  it('la pertenencia sigue ganando: un cliente ajeno recibe 403, no 422', async () => {
    prisma.clienteBarberia.findFirst = vi.fn(async () => null);
    prisma.usuarioRol.findFirst = vi.fn(async () => null);

    const { status, codigo } = await capturarError(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-ajeno'),
    );

    expect(status).toBe(403);
    expect(codigo).toBeUndefined();
  });

  it('control: con la sede ACTIVO la lectura no cambia', async () => {
    prisma.barberia.findUnique = vi.fn(async ({ select }: any) =>
      select?.estado ? { estado: 'ACTIVO' } : { zonaHoraria: 'America/Santo_Domingo' },
    );

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-1'),
    ).resolves.toEqual([]);
  });
});