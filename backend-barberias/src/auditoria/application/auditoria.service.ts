import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';

export interface RegistrarAuditoriaDto {
  usuarioId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  contexto?: Record<string, any> | null;
}

export interface FiltrosAuditoriaDto {
  entidad?: string;
  entidadId?: string;
  accion?: string;
  usuarioId?: string;
  barberiaId?: string;
  limite?: number;
  offset?: number;
}

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
   * Registra de forma inmutable un evento en el log de auditoría (T8.2 / AUDIT-01).
   * Acepta un cliente transaccional opcional para participar en transacciones SERIALIZABLE.
   */
  async registrarEvento(
    dto: RegistrarAuditoriaDto,
    tx?: PrismaService | Prisma.TransactionClient,
  ) {
    const client = (tx as PrismaService) ?? this.prisma;
    const auditoria = await client.auditoria.create({
      data: {
        usuarioId: dto.usuarioId ?? null,
        accion: dto.accion,
        entidad: dto.entidad,
        entidadId: dto.entidadId ?? null,
        contexto: dto.contexto ?? undefined,
      },
    });

    this.logger.log(
      `[Auditoría] Acción: ${dto.accion} | Entidad: ${dto.entidad} (${dto.entidadId ?? 'N/A'}) | Usuario: ${dto.usuarioId ?? 'ANÓNIMO'}`,
    );

    return auditoria;
  }

  /**
   * Consulta el registro de auditoría filtrado por entidad, acción, usuario o barbería con paginación.
   */
  async consultarAuditorias(filtros: FiltrosAuditoriaDto = {}) {
    const { entidad, entidadId, accion, usuarioId, barberiaId, limite = 50, offset = 0 } = filtros;

    const where: any = {};
    if (entidad) where.entidad = entidad;
    if (entidadId) where.entidadId = entidadId;
    if (accion) where.accion = accion;
    if (usuarioId) where.usuarioId = usuarioId;
    if (barberiaId) {
      where.contexto = {
        path: ['barberiaId'],
        equals: barberiaId,
      };
    }

    const take = Math.min(Math.max(limite, 1), 100);
    const skip = Math.max(offset, 0);

    const [total, registros] = await Promise.all([
      this.prisma.auditoria.count({ where }),
      this.prisma.auditoria.findMany({
        where,
        take,
        skip,
        orderBy: { creadoAt: 'desc' },
        include: {
          usuario: {
            select: {
              id: true,
              nombreCompleto: true,
              correo: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      limite: take,
      offset: skip,
      registros,
    };
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
