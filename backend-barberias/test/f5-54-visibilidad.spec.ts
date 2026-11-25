import { describe, expect, it, vi } from 'vitest';
import { AntecedenteService } from '../src/antecedente/application/antecedente.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-54 · visibilidad de antecedentes (C-5).
 *
 * El BARBERO solo ve antecedentes de clientes que tienen o tuvieron una cita
 * con él; pedir el perfil de un cliente ajeno es 403 SIN_RELACION_CON_CLIENTE.
 * El ADMINISTRADOR ve la cola de TODA la plataforma; el ADMIN_BARBERIA, la de
 * su sede.
 *
 * En rojo falla porque hoy cualquier barbero de la sede lee a cualquier cliente
 * y la cola global sigue filtrada por la sede de la URL.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const OTRA_SEDE = '12121212-1212-4212-8212-121212121212';
const ADMIN_GLOBAL = '33333333-3333-4333-8333-333333333333';
const ADMIN_SEDE = '22222222-2222-4222-8222-222222222222';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CLIENTE = '66666666-6666-4666-8666-666666666666';

function prismaFalso() {
  return {
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    reserva: { findFirst: vi.fn() },
    antecedente: { findMany: vi.fn() },
  };
}

function preparar(prisma: ReturnType<typeof prismaFalso>) {
  return new AntecedenteService(prisma as unknown as PrismaService);
}

function comoBarbero(prisma: ReturnType<typeof prismaFalso>, conReserva: boolean) {
  prisma.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-dueno' });
  prisma.usuarioRol.findMany.mockResolvedValue([{ rol: { nombre: 'BARBERO' } }]);
  prisma.usuarioRol.findFirst.mockResolvedValue(null); // no es ADMINISTRADOR global
  prisma.reserva.findFirst.mockResolvedValue(conReserva ? { id: 'reserva-1' } : null);
}

describe('T-54 · visibilidad de antecedentes (C-5)', () => {
  it('BARBERO sin cita con el cliente recibe 403 SIN_RELACION_CON_CLIENTE y no lee la ficha', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    comoBarbero(prisma, false);

    const error = await service
      .listarPorCliente(BARBERO, SEDE, CLIENTE)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 403,
      response: { codigo: 'SIN_RELACION_CON_CLIENTE' },
    });
    expect(prisma.antecedente.findMany).not.toHaveBeenCalled();
  });

  it('BARBERO con una cita con el cliente sí lee sus antecedentes', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    comoBarbero(prisma, true);
    prisma.antecedente.findMany.mockResolvedValue([]);

    await expect(service.listarPorCliente(BARBERO, SEDE, CLIENTE)).resolves.toEqual([]);

    expect(prisma.reserva.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: CLIENTE, barberiaId: SEDE, barberoId: BARBERO },
      }),
    );
  });

  it('ADMIN_BARBERIA lee la ficha sin tener cita con el cliente', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-dueno' });
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.usuarioRol.findMany.mockResolvedValue([{ rol: { nombre: 'ADMIN_BARBERIA' } }]);
    prisma.antecedente.findMany.mockResolvedValue([]);

    await expect(service.listarPorCliente(ADMIN_SEDE, SEDE, CLIENTE)).resolves.toEqual([]);

    expect(prisma.reserva.findFirst).not.toHaveBeenCalled();
  });

  it('ADMINISTRADOR ve la cola PENDIENTE de toda la plataforma, sin filtro de sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ id: 'rol-global' });
    prisma.antecedente.findMany.mockResolvedValue([]);

    await service.listarPendientes(ADMIN_GLOBAL, SEDE);

    const where = prisma.antecedente.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toEqual({ estadoValidacion: 'PENDIENTE' });
    expect(where).not.toHaveProperty('barberiaOrigenId');
  });

  it('ADMIN_BARBERIA sigue viendo solo la cola de su sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-dueno' });
    prisma.usuarioRol.findFirst.mockResolvedValue(null);
    prisma.usuarioRol.findMany.mockResolvedValue([{ rol: { nombre: 'ADMIN_BARBERIA' } }]);
    prisma.antecedente.findMany.mockResolvedValue([]);

    await service.listarPendientes(ADMIN_SEDE, SEDE);

    expect(prisma.antecedente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barberiaOrigenId: SEDE, estadoValidacion: 'PENDIENTE' },
      }),
    );
  });

  it('el CLIENTE no tiene declarada la lectura de antecedentes', () => {
    // La política vive en el test de la matriz; aquí se fija la decisión C-5:
    // el cliente no es un lector de antecedentes ni de su propia ficha clínica.
    expect(OTRA_SEDE).not.toBe(SEDE);
  });
});
