import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgendaService } from './agenda.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { getQueueToken } from '@nestjs/bullmq';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgendaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('agenda-bloqueos'), useValue: mockQueue },
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
  });
});
