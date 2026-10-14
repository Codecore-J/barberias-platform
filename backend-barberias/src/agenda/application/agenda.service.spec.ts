import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgendaService } from './agenda.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';

const BARBERIA_B = 'barberia-b';

describe('AgendaService', () => {
  let service: AgendaService;

  const mockPrismaService = {
    barberia: {
      findUnique: vi.fn(),
    },
    usuarioRol: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    bloqueosAgenda: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      return cb(mockPrismaService);
    }),
  };

  const mockQueue = {
    add: vi.fn(),
    getJob: vi.fn(),
  };

  // E2-07 · D29: liberar un bloqueo se audita dentro de la transacción.
  const mockAuditoria = { registrarEvento: vi.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgendaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('agenda-bloqueos'), useValue: mockQueue },
        { provide: AuditoriaService, useValue: mockAuditoria },
      ],
    }).compile();

    service = module.get<AgendaService>(AgendaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('crearBloqueo', () => {
    it('debe encolar un job si liberacionAutomaticaMinutos esta presente', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'uuid-user' });
      mockPrismaService.bloqueosAgenda.create.mockResolvedValue({ id: 'uuid-bloqueo' });
      mockQueue.add.mockResolvedValue({ id: 'job-123' });

      await service.crearBloqueo('uuid-user', 'uuid-barberia', {
        fecha: '2026-10-10',
        horaInicio: '10:00',
        horaFin: '11:00',
        liberacionAutomaticaMinutos: 15,
      });

      expect(mockQueue.add).toHaveBeenCalledWith('liberar-bloqueo', { bloqueoId: 'uuid-bloqueo' }, { delay: 15 * 60 * 1000 });
      expect(mockPrismaService.bloqueosAgenda.update).toHaveBeenCalledWith({
        where: { id: 'uuid-bloqueo' },
        data: { jobId: 'job-123' },
      });
    });
  });

  describe('liberarBloqueo (E2-07 · D29)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'admin-b' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { barberiaId: BARBERIA_B, rol: { nombre: 'ADMIN_BARBERIA' } },
      ]);
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
    });

    it('fija liberado_at en vez de borrar la fila, y audita el cambio', async () => {
      mockPrismaService.bloqueosAgenda.findUnique.mockResolvedValue({
        id: 'bloqueo-1',
        barberiaId: BARBERIA_B,
        fecha: new Date('2026-10-10T00:00:00.000Z'),
        horaInicio: new Date('1970-01-01T10:00:00.000Z'),
        horaFin: new Date('1970-01-01T11:00:00.000Z'),
        jobId: 'job-9',
        liberadoAt: null,
      });
      mockQueue.getJob.mockResolvedValue({
        isActive: async () => false,
        isCompleted: async () => false,
        remove: vi.fn(),
      });

      const resultado = await service.liberarBloqueo('admin-b', BARBERIA_B, 'bloqueo-1');

      expect(resultado.success).toBe(true);
      // Lo que NO debe pasar: el borrado que hacía el `DELETE` de antes.
      expect(mockPrismaService.bloqueosAgenda.delete).not.toHaveBeenCalled();
      expect(mockPrismaService.bloqueosAgenda.update).toHaveBeenCalledWith({
        where: { id: 'bloqueo-1' },
        data: { liberadoAt: expect.any(Date), jobId: null },
      });
      expect(mockAuditoria.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: 'admin-b',
          accion: 'BLOQUEO_LIBERADO',
          entidad: 'bloqueos_agenda',
          entidadId: 'bloqueo-1',
        }),
        expect.anything(),
      );
    });

    it('es idempotente: un bloqueo ya liberado no se reescribe ni se audita', async () => {
      mockPrismaService.bloqueosAgenda.findUnique.mockResolvedValue({
        id: 'bloqueo-1',
        barberiaId: BARBERIA_B,
        liberadoAt: new Date('2026-10-11T09:00:00.000Z'),
      });

      const resultado = await service.liberarBloqueo('admin-b', BARBERIA_B, 'bloqueo-1');

      expect(resultado.message).toContain('ya estaba liberado');
      expect(mockPrismaService.bloqueosAgenda.update).not.toHaveBeenCalled();
      expect(mockAuditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('propaga NotFoundException si el bloqueo no es de esa barbería', async () => {
      mockPrismaService.bloqueosAgenda.findUnique.mockResolvedValue(null);

      await expect(
        service.liberarBloqueo('admin-b', BARBERIA_B, 'bloqueo-ajeno'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('obtenerBloqueos (E1-03 · H20)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('debe validar el acceso antes de leer los bloqueos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-admin' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.bloqueosAgenda.findMany.mockResolvedValue([]);

      await expect(
        service.obtenerBloqueos('usuario-cliente', BARBERIA_B, new Date(), new Date()),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrismaService.bloqueosAgenda.findMany).not.toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si la barbería no existe', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue(null);

      await expect(
        service.obtenerBloqueos('usuario-cliente', BARBERIA_B, new Date(), new Date()),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.bloqueosAgenda.findMany).not.toHaveBeenCalled();
    });

    it('debe devolver los bloqueos al ADMIN de esa barbería', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'admin-b' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { barberiaId: BARBERIA_B, rol: { nombre: 'ADMIN_BARBERIA' } },
      ]);
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.bloqueosAgenda.findMany.mockResolvedValue([
        { id: 'bloqueo-1', motivo: 'H20 almuerzo' },
      ]);

      const result = await service.obtenerBloqueos(
        'admin-b',
        BARBERIA_B,
        new Date('2026-10-01'),
        new Date('2026-11-01'),
      );

      expect(mockPrismaService.bloqueosAgenda.findMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: 'bloqueo-1', motivo: 'H20 almuerzo' }]);
    });

    it('debe devolver los bloqueos al responsable, aunque no tenga ADMIN_BARBERIA', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'responsable' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.bloqueosAgenda.findMany.mockResolvedValue([]);

      await service.obtenerBloqueos('responsable', BARBERIA_B, new Date(), new Date());

      expect(mockPrismaService.bloqueosAgenda.findMany).toHaveBeenCalledTimes(1);
    });

    it('E1-04: debe dejar leer bloqueos al ADMINISTRADOR de otra barbería', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'admin-ajeno' });
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);
      // Solo es administrador global si la consulta busca el rol que existe.
      mockPrismaService.usuarioRol.findFirst.mockImplementation(async (args: any) =>
        args?.where?.rol?.nombre === 'ADMINISTRADOR' ? { id: 'ur-global' } : null,
      );
      mockPrismaService.bloqueosAgenda.findMany.mockResolvedValue([{ id: 'bloqueo-1' }]);

      const result = await service.obtenerBloqueos(
        'admin-global',
        BARBERIA_B,
        new Date(),
        new Date(),
      );

      expect(mockPrismaService.bloqueosAgenda.findMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ id: 'bloqueo-1' }]);
    });
  });
});
