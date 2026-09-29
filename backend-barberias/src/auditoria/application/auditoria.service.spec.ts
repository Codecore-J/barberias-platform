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
      create: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
    it('debe registrar un evento de auditoría correctamente (AUDIT-01)', async () => {
      const dto = {
        usuarioId: 'user-1',
        accion: 'REGISTRO_PAGO_EN_PERSONA',
        entidad: 'PAGO',
        entidadId: 'pago-1',
        contexto: { monto: 50, metodo: 'EFECTIVO' },
      };

      const mockCreated = { id: 'audit-1', ...dto, creadoAt: new Date() };
      mockPrismaService.auditoria.create.mockResolvedValue(mockCreated);

      const result = await service.registrarEvento(dto);

      expect(mockPrismaService.auditoria.create).toHaveBeenCalledWith({
        data: {
          usuarioId: dto.usuarioId,
          accion: dto.accion,
          entidad: dto.entidad,
          entidadId: dto.entidadId,
          contexto: dto.contexto,
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('debe registrar un evento usando una transacción proporcionada', async () => {
      const mockTx = {
        auditoria: {
          create: vi.fn().mockResolvedValue({ id: 'audit-tx-1' }),
        },
      };

      const dto = {
        accion: 'REGISTRO_PAGO_EN_PERSONA',
        entidad: 'PAGO',
      };

      await service.registrarEvento(dto, mockTx as any);

      expect(mockTx.auditoria.create).toHaveBeenCalled();
      expect(mockPrismaService.auditoria.create).not.toHaveBeenCalled();
    });

    it('debe consultar registros de auditoría filtrados con paginación', async () => {
      mockPrismaService.auditoria.count.mockResolvedValue(1);
      mockPrismaService.auditoria.findMany.mockResolvedValue([
        {
          id: 'audit-1',
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          usuario: { id: 'user-1', nombreCompleto: 'Test User', correo: 'test@barberia.com' },
        },
      ]);

      const res = await service.consultarAuditorias({
        entidad: 'PAGO',
        barberiaId: 'barberia-1',
        limite: 10,
        offset: 0,
      });

      expect(res.total).toBe(1);
      expect(res.registros).toHaveLength(1);
      expect(mockPrismaService.auditoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entidad: 'PAGO',
            contexto: { path: ['barberiaId'], equals: 'barberia-1' },
          }),
          take: 10,
          skip: 0,
        }),
      );
    });

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
