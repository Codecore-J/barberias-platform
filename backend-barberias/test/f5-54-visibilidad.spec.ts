import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { SolicitudAntecedenteService } from '../src/antecedente/application/solicitud-antecedente.service.js';

/**
 * T-54 · visibilidad de antecedentes (C-5) en el flujo de solicitudes.
 *
 * Las cuatro rutas `records` se eliminaron en F5. La garantía se conserva en el
 * flujo nuevo: el BARBERO solo ve sus propias solicitudes y los clientes de su
 * agenda; el ADMIN_BARBERIA ve toda su sede; el ADMINISTRADOR global resuelve
 * la bandeja transversal, sin filtro de sede.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN_GLOBAL = '33333333-3333-4333-8333-333333333333';
const ADMIN_SEDE = '22222222-2222-4222-8222-222222222222';
const BARBERO = '44444444-4444-4444-8444-444444444444';

function prismaFalso() {
  return {
    barberia: { findUnique: vi.fn(async () => ({ id: SEDE, zonaHoraria: 'UTC' })) },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    reserva: { findMany: vi.fn(async () => []) },
    solicitudAntecedente: { findMany: vi.fn(async () => []) },
  };
}

function preparar(prisma: ReturnType<typeof prismaFalso>) {
  return new SolicitudAntecedenteService(
    prisma as unknown as PrismaService,
    { ahora: () => new Date(), aInstante: () => new Date() } as unknown as TiempoService,
    { registrarEvento: vi.fn() } as unknown as AuditoriaService,
  );
}

describe('T-54 · visibilidad de antecedentes (C-5)', () => {
  it('el BARBERO solo lista las solicitudes que él mismo pidió', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'BARBERO' } });

    await service.listar(BARBERO, SEDE);

    expect(prisma.solicitudAntecedente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barberiaId: SEDE, solicitanteId: BARBERO },
      }),
    );
  });

  it('el ADMIN_BARBERIA ve las solicitudes de toda su sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'ADMIN_BARBERIA' } });

    await service.listar(ADMIN_SEDE, SEDE);

    const where = prisma.solicitudAntecedente.findMany.mock.calls[0][0].where as Record<
      string,
      unknown
    >;
    expect(where).toEqual({ barberiaId: SEDE });
    expect(where).not.toHaveProperty('solicitanteId');
  });

  it('el BARBERO solo ve los clientes de su propia agenda en el selector', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'BARBERO' } });

    await service.listarClientes(BARBERO, SEDE);

    expect(prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barberiaId: SEDE, barberoId: BARBERO },
      }),
    );
  });

  it('quien no es ADMINISTRADOR global no ve la bandeja de plataforma', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue(null);

    const error = await service.listarPendientesGlobal(ADMIN_SEDE).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 403,
      response: { codigo: 'SIN_PERMISO_ANTECEDENTES' },
    });
    expect(prisma.solicitudAntecedente.findMany).not.toHaveBeenCalled();
  });

  it('el ADMINISTRADOR ve la cola PENDIENTE de toda la plataforma, sin filtro de sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ id: 'rol-global' });

    await service.listarPendientesGlobal(ADMIN_GLOBAL);

    const where = prisma.solicitudAntecedente.findMany.mock.calls[0][0].where as Record<
      string,
      unknown
    >;
    expect(where).toEqual({ estado: 'PENDIENTE' });
    expect(where).not.toHaveProperty('barberiaId');
  });
});
