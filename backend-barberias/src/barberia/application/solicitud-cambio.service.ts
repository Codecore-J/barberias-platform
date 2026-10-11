import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { errorDeConflicto, errorDePermiso, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { alcanceCumple, esAdministradorGlobal, validarAsignacionRol } from '../../iam/domain/roles.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  ESTADOS_SOLICITUD_CAMBIO,
  MOTIVO_RECHAZO_MIN,
  TIPOS_SOLICITUD_CAMBIO,
} from '../domain/solicitud-cambio.js';
import type { CreateSolicitudCambioDto } from './dto/create-solicitud-cambio.dto.js';
import type { ListarSolicitudesCambioDto } from './dto/listar-solicitudes-cambio.dto.js';
import type { ResolverSolicitudCambioDto } from './dto/resolver-solicitud-cambio.dto.js';
import type { SolicitudCambioResponseDto } from './dto/solicitud-cambio-response.dto.js';

/** Un `valor_nuevo` de tipo RESPONSABLE tiene que ser un uuid, y solo un uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * E3-13 · solicitudes de cambio de nombre y responsable (D26).
 *
 * El nombre de una sede y su responsable no se editan por `PATCH /barberias/:id`:
 * la sede PROPONE (esta clase) y la plataforma RESUELVE. La aprobación de un
 * responsable es una transacción: cambia `barberias.responsable_id`, mueve el
 * rol `ADMIN_BARBERIA` del anterior al nuevo y audita, todo o nada.
 */
@Injectable()
export class SolicitudCambioService {
  private readonly logger = new Logger(SolicitudCambioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private aRespuesta(fila: any): SolicitudCambioResponseDto {
    const respuesta: SolicitudCambioResponseDto = {
      id: fila.id,
      barberiaId: fila.barberiaId,
      tipo: fila.tipo,
      valorNuevo: fila.valorNuevo,
      estado: fila.estado,
      solicitadoPor: fila.solicitadoPor,
      resueltoPor: fila.resueltoPor ?? null,
      motivoRechazo: fila.motivoRechazo ?? null,
      creadoAt: fila.creadoAt ?? null,
      resueltoAt: fila.resueltoAt ?? null,
    };

    if (fila.barberia) {
      respuesta.barberia = { id: fila.barberia.id, nombre: fila.barberia.nombre };
    }

    return respuesta;
  }

  /**
   * ¿El solicitante administra ESA sede? El `RolesGuard` solo mira la lista
   * plana de roles, y con `:id` (no `:barberiaId`) tampoco resuelve la sede del
   * parámetro: la pertenencia real se comprueba aquí (fail-closed), como en el
   * resto de servicios del módulo.
   */
  private esAdminDeSede(usuario: UsuarioAutenticado, barberiaId: string): boolean {
    return (usuario?.rolesDetallados ?? []).some(
      (rol) => rol.nombre === 'ADMIN_BARBERIA' && alcanceCumple(rol, barberiaId),
    );
  }

  // ── CREAR (la sede propone) ────────────────────────────────────────────────

  async crearSolicitud(
    barberiaId: string,
    usuario: UsuarioAutenticado,
    dto: CreateSolicitudCambioDto,
  ): Promise<SolicitudCambioResponseDto> {
    if (!esAdministradorGlobal(usuario) && !this.esAdminDeSede(usuario, barberiaId)) {
      throw errorDePermiso(
        'SOLO_ADMIN_BARBERIA',
        'Solo el ADMIN_BARBERIA de esta barbería puede solicitar cambios en su sede.',
      );
    }

    return withSerializableTransaction(this.prisma, async (tx) => {
      const barberia = await tx.barberia.findUnique({
        where: { id: barberiaId },
        select: { id: true, nombre: true, responsableId: true },
      });

      if (!barberia) {
        throw new NotFoundException(`Barbería ${barberiaId} no encontrada.`);
      }

      const valorNuevo = dto.valorNuevo.trim();

      if (dto.tipo === TIPOS_SOLICITUD_CAMBIO.RESPONSABLE) {
        if (!UUID.test(valorNuevo)) {
          throw reglaDeNegocio(
            'RESPONSABLE_INEXISTENTE',
            'El valor propuesto para el responsable debe ser el identificador de un usuario existente.',
          );
        }

        const nuevo = await tx.usuario.findUnique({
          where: { id: valorNuevo },
          select: { id: true },
        });

        if (!nuevo) {
          throw reglaDeNegocio(
            'RESPONSABLE_INEXISTENTE',
            'El usuario propuesto como nuevo responsable no existe.',
          );
        }

        if (nuevo.id === barberia.responsableId) {
          throw reglaDeNegocio(
            'SIN_CAMBIOS',
            'El usuario propuesto ya es el responsable de esta barbería.',
          );
        }
      } else if (valorNuevo === barberia.nombre) {
        throw reglaDeNegocio(
          'SIN_CAMBIOS',
          'El nombre propuesto es el mismo que ya tiene la barbería.',
        );
      }

      // Una sola solicitud viva por sede y tipo: la resolución del
      // ADMINISTRADOR no puede quedar ambigua.
      const pendiente = await tx.solicitudCambioBarberia.findFirst({
        where: {
          barberiaId,
          tipo: dto.tipo,
          estado: ESTADOS_SOLICITUD_CAMBIO.PENDIENTE,
        },
        select: { id: true },
      });

      if (pendiente) {
        throw errorDeConflicto(
          'SOLICITUD_PENDIENTE',
          `Ya existe una solicitud de ${dto.tipo.toLowerCase()} pendiente para esta barbería.`,
        );
      }

      const creada = await tx.solicitudCambioBarberia.create({
        data: {
          barberiaId,
          tipo: dto.tipo,
          valorNuevo,
          estado: ESTADOS_SOLICITUD_CAMBIO.PENDIENTE,
          solicitadoPor: usuario.id,
        },
      });

      // D28: la auditoría participa de la misma transacción.
      await this.auditoria.registrarEvento(
        {
          usuarioId: usuario.id,
          accion: 'SOLICITUD_CAMBIO_CREADA',
          entidad: 'solicitud_cambio_barberia',
          entidadId: creada.id,
          contexto: { barberiaId, tipo: dto.tipo, valorNuevo },
        },
        tx,
      );

      this.logger.log(
        `Solicitud ${creada.id} (${dto.tipo}) creada por ${usuario.id} para la barbería ${barberiaId}`,
      );

      return this.aRespuesta(creada);
    });
  }

  // ── LISTAR (solo plataforma) ───────────────────────────────────────────────

  /** Listado paginado en la forma D32 `{ data, total, page, pageSize }`. */
  async listar(dto: ListarSolicitudesCambioDto) {
    const where: { estado?: string; barberiaId?: string } = {};
    if (dto.estado) where.estado = dto.estado;
    if (dto.barberiaId) where.barberiaId = dto.barberiaId;

    const pageSize = Math.min(Math.max(dto.pageSize ?? 50, 1), 100);
    const page = Math.max(dto.page ?? 1, 1);

    const [total, filas] = await Promise.all([
      this.prisma.solicitudCambioBarberia.count({ where }),
      this.prisma.solicitudCambioBarberia.findMany({
        where,
        take: pageSize,
        skip: (page - 1) * pageSize,
        orderBy: { creadoAt: 'desc' },
        include: { barberia: { select: { id: true, nombre: true } } },
      }),
    ]);

    return {
      data: filas.map((fila) => this.aRespuesta(fila)),
      total,
      page,
      pageSize,
    };
  }

  // ── RESOLVER (solo plataforma) ─────────────────────────────────────────────

  async resolver(
    solicitudId: string,
    usuario: UsuarioAutenticado,
    dto: ResolverSolicitudCambioDto,
  ): Promise<SolicitudCambioResponseDto> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const solicitud = await tx.solicitudCambioBarberia.findUnique({
        where: { id: solicitudId },
      });

      if (!solicitud) {
        throw new NotFoundException(`Solicitud ${solicitudId} no encontrada.`);
      }

      if (solicitud.estado !== ESTADOS_SOLICITUD_CAMBIO.PENDIENTE) {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `La solicitud ya fue resuelta (${solicitud.estado}).`,
        );
      }

      // ── Rechazo ───────────────────────────────────────────────────────────
      if (!dto.aprobar) {
        const motivo = dto.motivoRechazo?.trim();

        if (!motivo || motivo.length < MOTIVO_RECHAZO_MIN) {
          throw reglaDeNegocio(
            'MOTIVO_REQUERIDO',
            `El rechazo exige un motivo de al menos ${MOTIVO_RECHAZO_MIN} caracteres.`,
          );
        }

        const rechazada = await tx.solicitudCambioBarberia.update({
          where: { id: solicitudId },
          data: {
            estado: ESTADOS_SOLICITUD_CAMBIO.RECHAZADA,
            motivoRechazo: motivo,
            resueltoPor: usuario.id,
            resueltoAt: new Date(),
          },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId: usuario.id,
            accion: 'SOLICITUD_CAMBIO_RECHAZADA',
            entidad: 'solicitud_cambio_barberia',
            entidadId: solicitudId,
            contexto: {
              barberiaId: solicitud.barberiaId,
              tipo: solicitud.tipo,
              motivo,
            },
          },
          tx,
        );

        return this.aRespuesta(rechazada);
      }

      // ── Aprobación ────────────────────────────────────────────────────────
      const barberia = await tx.barberia.findUnique({
        where: { id: solicitud.barberiaId },
        select: { id: true, nombre: true, responsableId: true },
      });

      if (!barberia) {
        throw new NotFoundException(`Barbería ${solicitud.barberiaId} no encontrada.`);
      }

      let responsableAnterior: string | null = null;

      if (solicitud.tipo === TIPOS_SOLICITUD_CAMBIO.RESPONSABLE) {
        const nuevo = await tx.usuario.findUnique({
          where: { id: solicitud.valorNuevo },
          select: { id: true },
        });

        // El usuario propuesto pudo desaparecer entre la solicitud y la
        // aprobación: sin él la transacción no puede dejar la sede sin
        // responsable con rol, así que se aborta entera.
        if (!nuevo) {
          throw reglaDeNegocio(
            'RESPONSABLE_INEXISTENTE',
            'El usuario propuesto como nuevo responsable ya no existe.',
          );
        }

        if (nuevo.id === barberia.responsableId) {
          throw reglaDeNegocio(
            'SIN_CAMBIOS',
            'El usuario propuesto ya es el responsable de esta barbería.',
          );
        }

        responsableAnterior = barberia.responsableId;

        const rolAdminBarberia = await tx.rol.findUnique({
          where: { nombre: 'ADMIN_BARBERIA' },
          select: { id: true, nombre: true, ambito: true },
        });

        if (rolAdminBarberia) {
          // E1-04: un rol de ámbito BARBERIA siempre lleva barbería.
          validarAsignacionRol(rolAdminBarberia, barberia.id);

          // El rol se MUEVE: se retira del anterior y se asigna al nuevo. Si el
          // nuevo ya lo tuviera, el deleteMany no lo toca y el upsert no duplica
          // (uk_usuario_rol_barberia).
          await tx.usuarioRol.deleteMany({
            where: {
              rolId: rolAdminBarberia.id,
              barberiaId: barberia.id,
              usuarioId: { not: nuevo.id },
            },
          });

          await tx.usuarioRol.upsert({
            where: {
              uk_usuario_rol_barberia: {
                usuarioId: nuevo.id,
                rolId: rolAdminBarberia.id,
                barberiaId: barberia.id,
              },
            },
            create: {
              usuarioId: nuevo.id,
              rolId: rolAdminBarberia.id,
              barberiaId: barberia.id,
            },
            update: {},
          });
        }

        await tx.barberia.update({
          where: { id: barberia.id },
          data: { responsableId: nuevo.id },
        });
      } else {
        await tx.barberia.update({
          where: { id: barberia.id },
          data: { nombre: solicitud.valorNuevo },
        });
      }

      const aprobada = await tx.solicitudCambioBarberia.update({
        where: { id: solicitudId },
        data: {
          estado: ESTADOS_SOLICITUD_CAMBIO.APROBADA,
          resueltoPor: usuario.id,
          resueltoAt: new Date(),
        },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: usuario.id,
          accion:
            solicitud.tipo === TIPOS_SOLICITUD_CAMBIO.RESPONSABLE
              ? 'SOLICITUD_CAMBIO_RESPONSABLE_APROBADA'
              : 'SOLICITUD_CAMBIO_NOMBRE_APROBADA',
          entidad: 'barberia',
          entidadId: barberia.id,
          contexto: {
            solicitudId,
            barberiaId: barberia.id,
            tipo: solicitud.tipo,
            valorNuevo: solicitud.valorNuevo,
            responsableAnterior,
          },
        },
        tx,
      );

      this.logger.log(`Solicitud ${solicitudId} (${solicitud.tipo}) aprobada por ${usuario.id}`);

      return this.aRespuesta(aprobada);
    });
  }
}
