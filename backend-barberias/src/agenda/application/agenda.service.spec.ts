import { Test, TestingModule } from '@nestjs/testing';
import { AgendaService } from './agenda.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { getQueueToken } from '@nestjs/bullmq';

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
});
