import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { alcanceCumple, esAdministradorGlobal } from '../../iam/domain/roles.js';
import {
  encolarConLimite,
  type ResultadoEncolado,
} from '../../shared/queues/encolado-seguro.js';

/**
 * H63 · Techo del registro del cron durante el ARRANQUE de la aplicación.
 *
 * Más generoso que el techo de encolado de las rutas (2 s) porque aquí no hay
 * nadie esperando una respuesta HTTP y un Redis remoto legítimamente lento no
 * debe quedar marcado como caído. Sigue siendo un límite estricto: el arranque
 * nunca espera más de esto a la cola de auditoría.
 */
export const REGISTRO_CRON_TIMEOUT_MS = 3000;

export interface RegistrarAuditoriaDto {
  usuarioId?: string | null;
  /** E3-01 · A-15: sede del evento, en su propia columna. */
  barberiaId?: string | null;
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
  page?: number;
  pageSize?: number;
}

/** Pagina de resultados con la forma { data, total, page, pageSize } (D32). */
export interface PaginaAuditoria<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditoriaService implements OnModuleInit {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('auditoria-purga') private readonly purgaQueue: Queue,
  ) {}

  /**
   * H63 · El arranque NO espera a la cola de auditoría.
   *
   * POR QUÉ (medido, no supuesto): `configurarJobRecurrente()` ya capturaba el
   * caso «Redis responde con error» —por eso la app arrancó con la cuota de
   * Upstash agotada—, pero cuando Redis NO responde `upsertJobScheduler` ni
   * resuelve ni rechaza (`maxRetriesPerRequest: null`, obligatorio en BullMQ), y
   * Nest espera a `onModuleInit` antes de escuchar. Resultado: con Redis caído
   * la aplicación no levantaba el servidor HTTP en absoluto.
   *
   * Arreglo: el registro del cron se lanza SIN `await` fuera de la cadena
   * crítica y con techo estricto (`programarPurgaDiaria`). Un cron de purga
   * diario no puede ser requisito para atender reservas, pagos o catálogos: la
   * dependencia es opcional y se degrada con una línea de error en el log. Si la
   * cola vuelve, la llamada pendiente se completa sola y el cron queda
   * registrado sin reiniciar el proceso (el id del scheduler es fijo, así que
   * registrarlo tarde es inofensivo).
   */
  onModuleInit(): void {
    void this.programarPurgaDiaria();
  }

  /**
   * Registra el cron diario de purga con techo de tiempo. NUNCA lanza: devuelve
   * el resultado del encolado para poder inspeccionarlo (y testearlo sin
   * depender de la suerte del temporizador).
   */
  async programarPurgaDiaria(): Promise<ResultadoEncolado<void>> {
    const resultado = await encolarConLimite(
      () => this.configurarJobRecurrente(),
      REGISTRO_CRON_TIMEOUT_MS,
    );

    if (!resultado.ok) {
      this.logger.error(
        `CRÍTICO: la cola de auditoría no respondió en ${REGISTRO_CRON_TIMEOUT_MS} ms al programar el cron de purga (${resultado.motivo}). La aplicación arranca SIN el cron diario; la purga retomará cuando la cola vuelva (la llamada queda pendiente y se completa sola), sin necesidad de reiniciar.`,
      );
    }

    return resultado;
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

    // Compatibilidad: los llamadores antiguos ponían la sede en
    // `contexto.barberiaId`. Se promueve a la columna para que el filtro por
    // sede no dependa de que cada uno se acuerde de la clave.
    const barberiaId =
      dto.barberiaId ?? dto.contexto?.barberiaId ?? null;

    const auditoria = await client.auditoria.create({
      data: {
        usuarioId: dto.usuarioId ?? null,
        barberiaId,
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
   * Decide qué barbería puede consultar el usuario (E1-02 / H18).
   *
   * Devuelve el `barberiaId` que se debe aplicar al filtro, o `null` cuando
   * el usuario es ADMINISTRADOR y consulta la vista global.
   *
   * Reglas:
   * - ADMINISTRADOR: vista global, `barberiaId` opcional.
   * - Cualquier otro: `barberiaId` obligatorio (400 si falta) y tiene que
   *   aparecer en sus `rolesDetallados` con ADMIN_BARBERIA (403 si no).
   *
   * Nunca devuelve `undefined`: para un usuario no global el filtro por
   * barbería es siempre obligatorio, así que la consulta nunca llega a
   * `where: {}`.
   */
  private barberiaConsultable(
    barberiaId: string | undefined,
    usuario?: UsuarioAutenticado | null,
  ): string | null {
    if (esAdministradorGlobal(usuario)) {
      return barberiaId ?? null;
    }

    if (!barberiaId) {
      throw new BadRequestException(
        'Debes indicar la barbería (query shopId o barberiaId) para consultar la auditoría.',
      );
    }

    // E1-04: el `barberiaId` nulo solo comodín para roles de ámbito GLOBAL.
    const detallado = (usuario?.rolesDetallados ?? []).some(
      (rol) => rol.nombre === 'ADMIN_BARBERIA' && alcanceCumple(rol, barberiaId),
    );

    if (!detallado) {
      throw new ForbiddenException(
        'No posees el rol ADMIN_BARBERIA en esa barbería.',
      );
    }

    return barberiaId;
  }

  /**
   * Consulta el registro de auditoría filtrado por entidad, acción, usuario o
   * barbería, con paginación `{ data, total, page, pageSize }` (D32).
   *
   * El filtro principal es la columna `auditoria.barberia_id` (E3-01 · A-15).
   * Se conserva un fallback por `contexto->>'barberiaId'` solo para filas
   * históricas anteriores a la migración; las nuevas se escriben en columna.
   */
  async consultarAuditorias(
    filtros: FiltrosAuditoriaDto = {},
    usuario?: UsuarioAutenticado | null,
  ): Promise<PaginaAuditoria<any>> {
    const { entidad, entidadId, accion, usuarioId } = filtros;
    const barberiaId = this.barberiaConsultable(filtros.barberiaId, usuario);

    const where: any = {};
    if (entidad) where.entidad = entidad;
    if (entidadId) where.entidadId = entidadId;
    if (accion) where.accion = accion;
    if (usuarioId) where.usuarioId = usuarioId;
    if (barberiaId) {
      where.OR = [
        { barberiaId },
        {
          barberiaId: null,
          contexto: { path: ['barberiaId'], equals: barberiaId },
        },
      ];
    }

    const pageSize = Math.min(Math.max(filtros.pageSize ?? 50, 1), 100);
    const page = Math.max(filtros.page ?? 1, 1);
    const skip = (page - 1) * pageSize;

    const [total, data] = await Promise.all([
      this.prisma.auditoria.count({ where }),
      this.prisma.auditoria.findMany({
        where,
        take: pageSize,
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

    return { data, total, page, pageSize };
  }

  /**
   * Programa el cron distribuido en BullMQ a las 03:00 AM todos los días (T8.2).
   *
   * Atrapa el rechazo (Redis que RESPONDE mal) y no acota la espera (Redis que
   * NO responde): el techo de tiempo lo pone quien la llama —`programarPurgaDiaria`
   * en el arranque—  para que este método siga siendo la operación "de verdad".
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
