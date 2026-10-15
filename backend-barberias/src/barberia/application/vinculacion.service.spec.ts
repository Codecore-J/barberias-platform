import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { VinculacionService } from './vinculacion.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

const SEDE_A = '11111111-1111-4111-8111-111111111111';
const SEDE_B = '22222222-2222-4222-8222-222222222222';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const VINCULO = '44444444-4444-4444-8444-444444444444';

const ADMINISTRADOR: UsuarioAutenticado = {
  id: 'admin-global',
  correo: 'global@test.com',
  roles: ['ADMINISTRADOR'],
  rolesDetallados: [{ nombre: 'ADMINISTRADOR', barberiaId: null, ambito: 'GLOBAL' }],
};

async function capturarError(
  promesa: Promise<unknown>,
): Promise<{ status: number; codigo: string }> {
  try {
    await promesa;
  } catch (error: any) {
    const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
    return { status: error?.getStatus?.() ?? respuesta.statusCode, codigo: respuesta.codigo };
  }
  throw new Error('Se esperaba una excepción y la promesa se resolvió.');
}

/** Fila pendiente tal y como la devuelve Prisma con `include`. */
function pendiente(extra: Record<string, unknown> = {}) {
  return {
    id: VINCULO,
    usuarioId: CLIENTE,
    barberiaId: SEDE_A,
    estadoVinculacion: 'PENDIENTE_APROBACION',
    esBarberiaActiva: false,
    creadoAt: new Date('2026-10-15T10:00:00.000Z'),
    usuario: {
      id: CLIENTE,
      nombreCompleto: 'Cliente Pendiente',
      correo: 'cliente@test.com',
      telefono: '600000001',
    },
    barberia: { id: SEDE_A, nombre: 'Barbería A' },
    ...extra,
  };
}

describe('VinculacionService (E3-12 · D10)', () => {
  let service: VinculacionService;
  let prisma: any;
  let auditoria: { registrarEvento: ReturnType<typeof vi.fn> };
  let notificacion: { enviarNotificacion: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    auditoria = { registrarEvento: vi.fn().mockResolvedValue({ id: 'auditoria-1' }) };
    notificacion = { enviarNotificacion: vi.fn().mockResolvedValue({ id: 'notificacion-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VinculacionService,
        { provide: AuditoriaService, useValue: auditoria },
        { provide: NotificacionService, useValue: notificacion },
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
            clienteBarberia: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              count: vi.fn(),
              groupBy: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<VinculacionService>(VinculacionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('listarPendientes', () => {
    it('devuelve las que esperan aprobación, con el cliente, la sede y el conteo de D10', async () => {
      prisma.clienteBarberia.findMany.mockResolvedValue([pendiente()]);
      prisma.clienteBarberia.count.mockResolvedValue(1);
      prisma.clienteBarberia.groupBy.mockResolvedValue([
        { usuarioId: CLIENTE, _count: { _all: 6 } },
      ]);

      const pagina = await service.listarPendientes({});

      expect(prisma.clienteBarberia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { estadoVinculacion: 'PENDIENTE_APROBACION' },
          orderBy: { creadoAt: 'asc' },
          skip: 0,
          take: 20,
        }),
      );

      expect(pagina).toEqual({
        data: [
          {
            vinculacionId: VINCULO,
            clienteId: CLIENTE,
            nombreCompleto: 'Cliente Pendiente',
            correo: 'cliente@test.com',
            telefono: '600000001',
            barberiaId: SEDE_A,
            barberiaNombre: 'Barbería A',
            estadoVinculacion: 'PENDIENTE_APROBACION',
            // Es el dato que explica POR QUÉ está pendiente: ya acumula cinco.
            vinculacionesDelCliente: 6,
            solicitadaAt: new Date('2026-10-15T10:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('la bandeja de plataforma mira TODAS las sedes; el filtro por sede es opcional', async () => {
      prisma.clienteBarberia.findMany.mockResolvedValue([]);
      prisma.clienteBarberia.count.mockResolvedValue(0);
      prisma.clienteBarberia.groupBy.mockResolvedValue([]);

      await service.listarPendientes({ barberiaId: SEDE_B, page: 2, pageSize: 5 });

      expect(prisma.clienteBarberia.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { estadoVinculacion: 'PENDIENTE_APROBACION', barberiaId: SEDE_B },
          skip: 5,
          take: 5,
        }),
      );
    });

    it('un conteo ausente no inventa un número: queda en 0', async () => {
      prisma.clienteBarberia.findMany.mockResolvedValue([
        pendiente({ usuario: { id: CLIENTE, nombreCompleto: 'X', correo: 'x@test.com', telefono: null } }),
      ]);
      prisma.clienteBarberia.count.mockResolvedValue(1);
      prisma.clienteBarberia.groupBy.mockResolvedValue([]);

      const pagina = await service.listarPendientes({});

      expect(pagina.data[0].vinculacionesDelCliente).toBe(0);
      expect(pagina.data[0].telefono).toBeNull();
    });
  });

  describe('aprobar', () => {
    it('VERDE: deja la vinculación ACTIVO, la audita y avisa al cliente', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente());
      prisma.clienteBarberia.update.mockResolvedValue(
        pendiente({ estadoVinculacion: 'ACTIVO' }),
      );

      const resultado = await service.aprobar(VINCULO, ADMINISTRADOR);

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULO },
        data: { estadoVinculacion: 'ACTIVO' },
      });

      expect(resultado).toEqual({
        vinculacionId: VINCULO,
        clienteId: CLIENTE,
        barberiaId: SEDE_A,
        estadoVinculacion: 'ACTIVO',
        motivo: null,
        resueltoPor: ADMINISTRADOR.id,
      });

      expect(auditoria.registrarEvento).toHaveBeenCalledTimes(1);
      const [evento] = auditoria.registrarEvento.mock.calls[0];
      expect(evento).toMatchObject({
        usuarioId: ADMINISTRADOR.id,
        accion: 'VINCULACION_APROBADA',
        entidad: 'cliente_barberias',
        entidadId: VINCULO,
        contexto: {
          barberiaId: SEDE_A,
          clienteId: CLIENTE,
          anterior: { estadoVinculacion: 'PENDIENTE_APROBACION' },
          nuevo: { estadoVinculacion: 'ACTIVO' },
        },
      });

      expect(notificacion.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: CLIENTE, tipo: 'VINCULACION_APROBADA' }),
      );
    });

    it('404 si la vinculación no existe', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);

      await expect(service.aprobar(VINCULO, ADMINISTRADOR)).rejects.toThrowError(
        NotFoundException,
      );
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('409 ESTADO_INVALIDO si la vinculación ya se resolvió (no se reescribe ni se audita)', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(
        pendiente({ estadoVinculacion: 'DESVINCULADO' }),
      );

      await expect(service.aprobar(VINCULO, ADMINISTRADOR)).rejects.toThrowError(
        ConflictException,
      );

      const error = await capturarError(
        service.aprobar(VINCULO, ADMINISTRADOR),
      );
      expect(error.codigo).toBe('ESTADO_INVALIDO');
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('si la cola de avisos falla, la aprobación NO se cae (aviso best-effort)', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente());
      prisma.clienteBarberia.update.mockResolvedValue(pendiente({ estadoVinculacion: 'ACTIVO' }));
      notificacion.enviarNotificacion.mockRejectedValue(new Error('Redis no responde'));

      await expect(service.aprobar(VINCULO, ADMINISTRADOR)).resolves.toMatchObject({
        estadoVinculacion: 'ACTIVO',
      });

      // El rechazo de la promesa se despacha sin bloquear: se le da un turno.
      await new Promise((resolve) => setImmediate(resolve));
      expect(auditoria.registrarEvento).toHaveBeenCalledTimes(1);
    });
  });

  describe('rechazar', () => {
    it('422 MOTIVO_REQUERIDO sin motivo: el rechazo no se firma en blanco', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente());

      const error = await capturarError(service.rechazar(VINCULO, ADMINISTRADOR, {}));

      expect(error).toEqual({ status: 422, codigo: 'MOTIVO_REQUERIDO' });
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('422 MOTIVO_REQUERIDO si el motivo es una palabra suelta', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente());

      const error = await capturarError(service.rechazar(VINCULO, ADMINISTRADOR, { motivo: 'no' }));

      expect(error).toEqual({ status: 422, codigo: 'MOTIVO_REQUERIDO' });
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('VERDE: rechazar deja DESVINCULADO, apaga la sede activa, audita el motivo y avisa', async () => {
      const motivo = 'El cliente ya superó el límite de cinco barberías activas.';
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente());
      prisma.clienteBarberia.update.mockResolvedValue(
        pendiente({ estadoVinculacion: 'DESVINCULADO' }),
      );

      const resultado = await service.rechazar(VINCULO, ADMINISTRADOR, { motivo });

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULO },
        data: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
      });

      expect(resultado).toMatchObject({
        vinculacionId: VINCULO,
        estadoVinculacion: 'DESVINCULADO',
        motivo,
        resueltoPor: ADMINISTRADOR.id,
      });

      const [evento] = auditoria.registrarEvento.mock.calls[0];
      expect(evento).toMatchObject({
        accion: 'VINCULACION_RECHAZADA',
        entidadId: VINCULO,
        contexto: {
          barberiaId: SEDE_A,
          clienteId: CLIENTE,
          motivo,
          anterior: { estadoVinculacion: 'PENDIENTE_APROBACION' },
          nuevo: { estadoVinculacion: 'DESVINCULADO' },
        },
      });

      expect(notificacion.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: CLIENTE, tipo: 'VINCULACION_RECHAZADA' }),
      );
    });

    it('409 ESTADO_INVALIDO si la vinculación ya estaba resuelta', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(
        pendiente({ estadoVinculacion: 'ACTIVO' }),
      );

      const error = await capturarError(
        service.rechazar(VINCULO, ADMINISTRADOR, { motivo: 'Un motivo suficientemente largo.' }),
      );

      expect(error).toEqual({ status: 409, codigo: 'ESTADO_INVALIDO' });
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });
  });
});
