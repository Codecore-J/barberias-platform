import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { SolicitudAntecedenteService } from '../src/antecedente/application/solicitud-antecedente.service.js';
import { SolicitudAntecedenteClientesController } from '../src/antecedente/infrastructure/solicitud-antecedente.controller.js';

/**
 * T-55 · selector de clientes de la sede.
 *
 * El formulario no puede inventar un UUID: la pantalla necesita la lista de
 * clientes que ya pasaron por la sede. El BARBERO solo ve los de su agenda; la
 * sede, todos los de sus reservas.
 *
 * En rojo falla porque la ruta y el método no existen.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN_SEDE = '22222222-2222-4222-8222-222222222222';
const BARBERO = '44444444-4444-4444-8444-444444444444';

function prismaFalso() {
  return {
    barberia: { findUnique: vi.fn(async () => ({ id: SEDE, zonaHoraria: 'UTC' })) },
    usuarioRol: { findFirst: vi.fn() },
    // El tipo del retorno no es decorativo: con `[]` a secas el mock resuelve
    // `never[]` y `mockResolvedValue` rechaza cualquier fila real.
    reserva: {
      findMany: vi.fn(
        async (_args?: unknown) =>
          [] as Array<{
            cliente: { id: string; nombreCompleto: string; correo: string };
          }>,
      ),
    },
  };
}

function preparar(prisma: ReturnType<typeof prismaFalso>) {
  return new SolicitudAntecedenteService(
    prisma as unknown as PrismaService,
    { ahora: () => new Date(), aInstante: () => new Date() } as unknown as TiempoService,
    { registrarEvento: vi.fn() } as unknown as AuditoriaService,
  );
}

describe('T-55 · clientes para el selector', () => {
  it('la sede ve los clientes de sus reservas, sin repetir', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'ADMIN_BARBERIA' } });
    prisma.reserva.findMany.mockResolvedValue([
      { cliente: { id: 'c1', nombreCompleto: 'Ana', correo: 'ana@test.com' } },
    ]);

    const res = await service.listarClientes(ADMIN_SEDE, SEDE);

    expect(res).toEqual([{ id: 'c1', nombreCompleto: 'Ana', correo: 'ana@test.com' }]);
    expect(prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { barberiaId: SEDE },
        distinct: ['clienteId'],
      }),
    );
  });

  it('el barbero solo ve los clientes de su propia agenda', async () => {
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

  it('declara GET /shops/:shopId/antecedentes/clientes', () => {
    const proto = SolicitudAntecedenteClientesController.prototype as unknown as Record<
      string,
      unknown
    >;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((candidato) => typeof candidato === 'function')
      .map((candidato) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([{ ruta: '/', metodo: RequestMethod.GET }]),
    );
  });
});
