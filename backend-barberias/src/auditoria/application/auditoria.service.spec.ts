import { Test, TestingModule } from '@nestjs/testing';
import { AuditoriaService } from './auditoria.service.js';
import { AuditoriaProcessor } from './auditoria.processor.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { getQueueToken } from '@nestjs/bullmq';

describe('AuditoriaService & Processor (T8.2)', () => {
  let service: AuditoriaService;
  let processor: AuditoriaProcessor;

  const mockPrismaService = {
    auditoria: {
      deleteMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const mockQueue = {
    add: vi.fn(),
    upsertJobScheduler: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditoriaService,
        AuditoriaProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('auditoria-purga'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuditoriaService>(AuditoriaService);
    processor = module.get<AuditoriaProcessor>(AuditoriaProcessor);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(processor).toBeDefined();
  });

  describe('AuditoriaService', () => {
    it('debe programar el cron diario de purga a las 03:00 AM en BullMQ', async () => {
      await service.configurarJobRecurrente();

      expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'purga-auditoria-diaria',
        { pattern: '0 3 * * *' },
        expect.objectContaining({
          name: 'purga-auditoria-diaria',
          data: { diasRetencion: 365 },
        }),
      );
    });

    it('debe purgar registros con más de 365 días de antigüedad', async () => {
      mockPrismaService.auditoria.deleteMany.mockResolvedValue({ count: 42 });

      const res = await service.purgarAuditoriasAntiguas(365);

      expect(res.registrosEliminados).toBe(42);
      expect(mockPrismaService.auditoria.deleteMany).toHaveBeenCalledWith({
        where: {
          creadoAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('debe retornar estadísticas de registros de auditoría', async () => {
      const fechaAntigua = new Date('2025-01-01');
      const fechaReciente = new Date('2026-09-28');

      mockPrismaService.auditoria.count.mockResolvedValue(150);
      mockPrismaService.auditoria.findFirst
        .mockResolvedValueOnce({ creadoAt: fechaAntigua })
        .mockResolvedValueOnce({ creadoAt: fechaReciente });

      const stats = await service.obtenerEstadisticas();

      expect(stats.totalRegistros).toBe(150);
      expect(stats.registroMasAntiguo).toEqual(fechaAntigua);
      expect(stats.registroMasReciente).toEqual(fechaReciente);
      expect(stats.politicaRetencionDias).toBe(365);
    });
  });

  describe('AuditoriaProcessor', () => {
    it('debe procesar el job purga-auditoria-diaria y ejecutar la purga', async () => {
      mockPrismaService.auditoria.deleteMany.mockResolvedValue({ count: 18 });

      const mockJob: any = {
        name: 'purga-auditoria-diaria',
        data: { diasRetencion: 365 },
      };

      const result = await processor.process(mockJob);

      expect(result.registrosEliminados).toBe(18);
      expect(mockPrismaService.auditoria.deleteMany).toHaveBeenCalled();
    });
  });
});
