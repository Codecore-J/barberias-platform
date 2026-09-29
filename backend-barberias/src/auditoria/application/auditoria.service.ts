import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class AuditoriaService implements OnModuleInit {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('auditoria-purga') private readonly purgaQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.configurarJobRecurrente();
  }

  /**
   * Programa el cron distribuido en BullMQ a las 03:00 AM todos los días (T8.2).
   */
  async configurarJobRecurrente() {
    try {
      await this.purgaQueue.upsertJobScheduler(
        'purga-auditoria-diaria',
        { pattern: '0 3 * * *' },
        {
          name: 'purga-auditoria-diaria',
          data: { diasRetencion: 365 },
          opts: {
            removeOnComplete: true,
            removeOnFail: 50,
          },
        },
      );
      this.logger.log('Job cron distribuido de purga de auditoría programado (03:00 AM diario: 0 3 * * *)');
    } catch (error: any) {
      this.logger.warn(`No se pudo programar cron de purga en BullMQ: ${error.message}`);
    }
  }

  /**
   * Elimina de forma atómica los registros de auditoría que superen los días de retención (T8.2).
   */
  async purgarAuditoriasAntiguas(diasRetencion = 365): Promise<{ registrosEliminados: number; fechaCorte: Date }> {
    const fechaCorte = new Date();
    fechaCorte.setDate(fechaCorte.getDate() - diasRetencion);

    const result = await this.prisma.auditoria.deleteMany({
      where: {
        creadoAt: {
          lt: fechaCorte,
        },
      },
    });

    this.logger.log(
      `Purga de auditoría completada: ${result.count} registros eliminados anteriores a ${fechaCorte.toISOString()}`,
    );

    return {
      registrosEliminados: result.count,
      fechaCorte,
    };
  }

  /**
   * Retorna estadísticas del volumen y antigüedad de los registros de auditoría.
   */
  async obtenerEstadisticas() {
    const totalRegistros = await this.prisma.auditoria.count();
    const masAntiguo = await this.prisma.auditoria.findFirst({
      orderBy: { creadoAt: 'asc' },
      select: { creadoAt: true },
    });
    const masReciente = await this.prisma.auditoria.findFirst({
      orderBy: { creadoAt: 'desc' },
      select: { creadoAt: true },
    });

    return {
      totalRegistros,
      registroMasAntiguo: masAntiguo?.creadoAt ?? null,
      registroMasReciente: masReciente?.creadoAt ?? null,
      politicaRetencionDias: 365,
    };
  }
}
