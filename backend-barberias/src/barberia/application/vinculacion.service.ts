import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeConflicto, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { NotificacionService } from '../../notificacion/application/notificacion.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  ESTADOS_VINCULACION,
  MOTIVO_RECHAZO_VINCULACION_MIN,
  esVinculacionResoluble,
  estadoDeResolucion,
} from '../domain/vinculacion.js';
import type { ListarVinculacionesPendientesDto } from './dto/listar-vinculaciones-pendientes.dto.js';
import type { RechazarVinculacionDto } from './dto/rechazar-vinculacion.dto.js';

/** Tamaño de página por defecto de la bandeja (D32). */
export const PAGE_SIZE_POR_DEFECTO = 20;

/** Fila de la bandeja de aprobación. Se compone a mano: nunca la fila cruda. */
export interface VinculacionPendienteDto {
  vinculacionId: string;
  clienteId: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  barberiaId: string;
  barberiaNombre: string;
  estadoVinculacion: string;
  /**
   * Cuántas vinculaciones tiene ya el cliente. Es el dato que EXPLICA por qué
   * esta está pendiente (D10): a partir de la sexta, la plataforma decide.
   */
  vinculacionesDelCliente: number;
  solicitadaAt: Date | null;
}

/** Resultado de aprobar o rechazar. */
export interface VinculacionResueltaDto {
  vinculacionId: string;
  clienteId: string;
  barberiaId: string;
  estadoVinculacion: string;
  /** Motivo del rechazo; `null` cuando se aprobó. */
  motivo: string | null;
  /** Quién resolvió la solicitud: el ADMINISTRADOR de la plataforma. */
  resueltoPor: string;
}

export interface PaginaVinculacionesPendientes {
  data: VinculacionPendienteDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * E3-12 · bandeja de aprobación de la 6.ª vinculación (D10 · H67).
 *
 * Hasta aquí `vincularCliente` asignaba `PENDIENTE_APROBACION` a partir de la
 * sexta vinculación y ese estado BLOQUEABA la sede (el vínculo pendiente no
 * autoriza), pero nadie podía aprobarlo: el cliente quedaba esperando para
 * siempre. Este servicio es la mitad que faltaba.
 *
 * Quién resuelve, y por qué NO la sede: el límite de D10 se cuenta por USUARIO
 * (`barberia.service.ts` cuenta las filas del cliente, no las de una sede), así
 * que la decisión es de plataforma. Una sede interesada en captar al cliente
 * aprobaría siempre, y con eso el límite dejaría de existir. La ruta declara
 * `@Roles('ADMINISTRADOR')` y el `RolesGuard` deniega al resto por fail-closed.
 *
 * Los dos desenlaces están auditados con el valor anterior y el nuevo (D28) y
 * avisan al cliente; el aviso es best-effort y se despacha DESPUÉS del commit.
 */
@Injectable()
export class VinculacionService {
  private readonly logger = new Logger(VinculacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    @Optional() private readonly notificacion?: NotificacionService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private aPendiente(fila: any, vinculacionesDelCliente: number): VinculacionPendienteDto {
    return {
      vinculacionId: fila.id,
      clienteId: fila.usuarioId,
      nombreCompleto: fila.usuario.nombreCompleto,
      correo: fila.usuario.correo,
      telefono: fila.usuario.telefono ?? null,
      barberiaId: fila.barberiaId,
      barberiaNombre: fila.barberia.nombre,
      estadoVinculacion: fila.estadoVinculacion,
      vinculacionesDelCliente,
      solicitadaAt: fila.creadoAt ?? null,
    };
  }

  /** Cuántas vinculaciones acumula cada cliente de la página, en UNA consulta. */
  private async conteosPorCliente(usuarioIds: string[]): Promise<Map<string, number>> {
    if (usuarioIds.length === 0) {
      return new Map();
    }

    const filas = await this.prisma.clienteBarberia.groupBy({
      by: ['usuarioId'],
      where: { usuarioId: { in: usuarioIds } },
      _count: { _all: true },
    });

    return new Map(filas.map((fila: any) => [fila.usuarioId, fila._count._all]));
  }

  /**
   * El aviso al cliente es best-effort y posterior al commit, igual que en el
   * alta de reserva (H62): que la cola esté caída no puede dejar sin resolver
   * una vinculación que la plataforma ya decidió.
   */
  private avisarCliente(usuarioId: string, tipo: string, contenido: string): void {
    if (!this.notificacion) {
      return;
    }

    this.notificacion
      .enviarNotificacion({ usuarioId, tipo, contenido })
      .catch((error: Error) =>
        this.logger.warn(`No se pudo despachar la notificación ${tipo}: ${error.message}`),
      );
  }

  // ── BANDEJA (solo plataforma) ──────────────────────────────────────────────

  /**
   * `GET /plataforma/vinculaciones/pendientes`.
   *
   * Por orden de llegada (`creadoAt` asc): el que más lleva esperando es el que
   * más urge resolver. El `where` nunca sale sin el estado pendiente, así que la
   * bandeja no puede mostrar vínculos que ya están en circulación.
   */
  async listarPendientes(
    dto: ListarVinculacionesPendientesDto,
  ): Promise<PaginaVinculacionesPendientes> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? PAGE_SIZE_POR_DEFECTO;

    const where = {
      estadoVinculacion: ESTADOS_VINCULACION.PENDIENTE_APROBACION,
      ...(dto.barberiaId ? { barberiaId: dto.barberiaId } : {}),
    };

    const [filas, total] = await Promise.all([
      this.prisma.clienteBarberia.findMany({
        where,
        include: {
          usuario: {
            select: { id: true, nombreCompleto: true, correo: true, telefono: true },
          },
          barberia: { select: { id: true, nombre: true } },
        },
        orderBy: { creadoAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.clienteBarberia.count({ where }),
    ]);

    const conteos = await this.conteosPorCliente(filas.map((fila: any) => fila.usuarioId));

    return {
      data: filas.map((fila: any) => this.aPendiente(fila, conteos.get(fila.usuarioId) ?? 0)),
      total,
      page,
      pageSize,
    };
  }

  // ── RESOLUCIÓN (solo plataforma) ───────────────────────────────────────────

  /** `POST /plataforma/vinculaciones/:id/aprobar` · la sexta entra en circulación. */
  async aprobar(
    vinculacionId: string,
    usuario: UsuarioAutenticado,
  ): Promise<VinculacionResueltaDto> {
    return this.resolver(vinculacionId, usuario, true, null);
  }

  /**
   * `POST /plataforma/vinculaciones/:id/rechazar { motivo }` · la sexta no entra.
   *
   * Rechazar deja el vínculo en `DESVINCULADO` (D10 no tiene un estado
   * «rechazada»): es el vínculo cerrado que conserva la fila y su historial
   * (D20/D21).
   */
  async rechazar(
    vinculacionId: string,
    usuario: UsuarioAutenticado,
    dto: RechazarVinculacionDto,
  ): Promise<VinculacionResueltaDto> {
    return this.resolver(vinculacionId, usuario, false, dto.motivo);
  }

  private async resolver(
    vinculacionId: string,
    usuario: UsuarioAutenticado,
    aprobar: boolean,
    motivoCrudo?: string | null,
  ): Promise<VinculacionResueltaDto> {
    const motivo = (motivoCrudo ?? '').trim();

    // La regla no depende de la fila, así que se comprueba antes de tocar la
    // base: un rechazo sin motivo no llega ni a consultar.
    if (!aprobar && motivo.length < MOTIVO_RECHAZO_VINCULACION_MIN) {
      throw reglaDeNegocio(
        'MOTIVO_REQUERIDO',
        `El rechazo exige un motivo de al menos ${MOTIVO_RECHAZO_VINCULACION_MIN} caracteres.`,
      );
    }

    const { resuelta, nombreBarberia } = await withSerializableTransaction(
      this.prisma,
      async (tx) => {
        const vinculo = await tx.clienteBarberia.findUnique({
          where: { id: vinculacionId },
          include: { barberia: { select: { id: true, nombre: true } } },
        });

        if (!vinculo) {
          throw new NotFoundException(`Vinculación ${vinculacionId} no encontrada.`);
        }

        if (!esVinculacionResoluble(vinculo.estadoVinculacion)) {
          throw errorDeConflicto(
            'ESTADO_INVALIDO',
            `La vinculación ya está resuelta (${vinculo.estadoVinculacion}).`,
          );
        }

        const estadoVinculacion = estadoDeResolucion(aprobar);

        await tx.clienteBarberia.update({
          where: { id: vinculacionId },
          data: aprobar
            ? { estadoVinculacion }
            : // Rechazar además APAGA la sede activa: una fila sin vínculo no
              // puede seguir siendo la sede activa del cliente.
              { estadoVinculacion, esBarberiaActiva: false },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId: usuario.id,
            accion: aprobar ? 'VINCULACION_APROBADA' : 'VINCULACION_RECHAZADA',
            entidad: 'cliente_barberias',
            entidadId: vinculacionId,
            contexto: {
              barberiaId: vinculo.barberiaId,
              clienteId: vinculo.usuarioId,
              ...(aprobar ? {} : { motivo }),
              anterior: { estadoVinculacion: vinculo.estadoVinculacion },
              nuevo: { estadoVinculacion },
            },
          },
          tx,
        );

        const dto: VinculacionResueltaDto = {
          vinculacionId,
          clienteId: vinculo.usuarioId,
          barberiaId: vinculo.barberiaId,
          estadoVinculacion,
          motivo: aprobar ? null : motivo,
          resueltoPor: usuario.id,
        };

        return { resuelta: dto, nombreBarberia: vinculo.barberia?.nombre ?? 'la barbería' };
      },
    );

    // Fuera de la transacción: el aviso no puede revertir una decisión ya tomada.
    this.avisarCliente(
      resuelta.clienteId,
      aprobar ? 'VINCULACION_APROBADA' : 'VINCULACION_RECHAZADA',
      aprobar
        ? `Tu vinculación con ${nombreBarberia} fue aprobada. Ya puedes reservar en esta barbería.`
        : `Tu solicitud de vinculación con ${nombreBarberia} fue rechazada: ${motivo}`,
    );

    this.logger.log(
      `Vinculación ${vinculacionId} (cliente ${resuelta.clienteId}) resuelta como ${resuelta.estadoVinculacion} por ${usuario.id}`,
    );

    return resuelta;
  }
}
