import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionService } from './notificacion.service.js';
import { NotificacionProcessor } from './notificacion.processor.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';

describe('NotificacionService & Processor (T8.1)', () => {
  let service: NotificacionService;
  let processor: NotificacionProcessor;

  const mockPrismaService = {
    usuario: { findUnique: vi.fn() },
    notificacion: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    reserva: { findUnique: vi.fn() },
  };

  const mockQueue = {
    add: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificacionService,
        NotificacionProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken('notificaciones'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<NotificacionService>(NotificacionService);
    processor = module.get<NotificacionProcessor>(NotificacionProcessor);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(processor).toBeDefined();
  });

  describe('NotificacionService', () => {
    const usuarioId = 'uuid-usuario';

    it('debe encolar una notificación inmediata en BullMQ y guardar en BD', async () => {
      mockPrismaService.usuario.findUnique.mockResolvedValue({
        id: usuarioId,
        correo: 'test@notif.com',
      });

      mockPrismaService.notificacion.create.mockResolvedValue({
        id: 'uuid-notif',
        usuarioId,
        tipo: 'RESERVA_CONFIRMADA',
        estado: 'PENDIENTE',
      });

      const res = await service.enviarNotificacion({
        usuarioId,
        tipo: 'RESERVA_CONFIRMADA',
        contenido: 'Tu cita está confirmada',
      });

      expect(res.id).toBe('uuid-notif');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'enviar-notificacion',
        expect.objectContaining({
          notificacionId: 'uuid-notif',
          correo: 'test@notif.com',
          tipo: 'RESERVA_CONFIRMADA',
        }),
        expect.any(Object),
      );
    });

    it('debe lanzar NotFoundException si el destinatario no existe', async () => {
      mockPrismaService.usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.enviarNotificacion({
          usuarioId: 'uuid-inexistente',
          tipo: 'TEST',
          contenido: 'Hola',
        }),
      ).rejects.toThrowError(NotFoundException);
    });

    it('debe programar un recordatorio 1h antes con delay calculado', async () => {
      // Cita dentro de 3 horas
      const fechaCita = new Date(Date.now() + 3 * 3600 * 1000);
      const horaInicio = new Date('1970-01-01T15:00:00Z');

      mockQueue.add.mockResolvedValue({ id: 'job-recordatorio-1' });

      const job = await service.programarRecordatorio({
        usuarioId,
        reservaId: 'uuid-reserva',
        fechaCita,
        horaInicio,
        nombreBarberia: 'Barbería VIP',
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'recordatorio-cita',
        expect.objectContaining({
          usuarioId,
          reservaId: 'uuid-reserva',
          nombreBarberia: 'Barbería VIP',
        }),
        expect.objectContaining({
          delay: expect.any(Number),
        }),
      );
      expect(job.id).toBe('job-recordatorio-1');
    });
  });

  describe('NotificacionProcessor', () => {
    it('debe procesar enviar-notificacion marcando estado ENVIADO', async () => {
      mockPrismaService.notificacion.update.mockResolvedValue({
        id: 'uuid-notif',
        estado: 'ENVIADO',
      });

      const mockJob: any = {
        id: 'job-1',
        name: 'enviar-notificacion',
        data: {
          notificacionId: 'uuid-notif',
          canal: 'EMAIL',
          correo: 'test@notif.com',
          tipo: 'RESERVA_CONFIRMADA',
        },
      };

      const result = await processor.process(mockJob);
      expect(result.status).toBe('DELIVERED');
      expect(mockPrismaService.notificacion.update).toHaveBeenCalledWith({
        where: { id: 'uuid-notif' },
        data: expect.objectContaining({ estado: 'ENVIADO' }),
      });
    });

    it('debe procesar recordatorio-cita y persistir notificación si la reserva sigue CONFIRMADA', async () => {
      mockPrismaService.reserva.findUnique.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CONFIRMADA',
      });

      mockPrismaService.notificacion.create.mockResolvedValue({
        id: 'uuid-notif-rem',
      });

      const mockJob: any = {
        id: 'job-2',
        name: 'recordatorio-cita',
        data: {
          usuarioId: 'uuid-cliente',
          reservaId: 'uuid-reserva',
          nombreBarberia: 'Barbería Élite',
          fechaHoraCita: new Date().toISOString(),
        },
      };

      const result = await processor.process(mockJob);
      expect(result.status).toBe('REMINDER_SENT');
      expect(mockPrismaService.notificacion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: 'uuid-cliente',
            tipo: 'RECORDATORIO_CITA',
            estado: 'ENVIADO',
          }),
        }),
      );
    });

    it('debe descartar recordatorio si la reserva fue cancelada o expirada', async () => {
      mockPrismaService.reserva.findUnique.mockResolvedValue({
        id: 'uuid-reserva',
        estado: 'CANCELADA',
      });

      const mockJob: any = {
        id: 'job-3',
        name: 'recordatorio-cita',
        data: {
          usuarioId: 'uuid-cliente',
          reservaId: 'uuid-reserva',
          nombreBarberia: 'Barbería Élite',
          fechaHoraCita: new Date().toISOString(),
        },
      };

      const result = await processor.process(mockJob);
      expect(result.status).toBe('SKIPPED');
      expect(result.reason).toBe('RESERVA_INACTIVA');
      expect(mockPrismaService.notificacion.create).not.toHaveBeenCalled();
    });
  });
});
