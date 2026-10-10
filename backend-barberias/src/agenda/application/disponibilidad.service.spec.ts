import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
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