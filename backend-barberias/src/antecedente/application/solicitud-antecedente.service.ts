import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import {
  TiempoService,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import {
  errorDeConflicto,
  errorDePermiso,
  errorDeSolicitud,
  reglaDeNegocio,
} from '../../shared/errors/d40.errors.js';
import {
  ROL_ADMIN_BARBERIA,
  ROL_BARBERO,
  esAdministradorGlobalPorId,
} from '../../iam/domain/roles.js';
import {
  DecisionSolicitudAntecedente,
  type CrearSolicitudAntecedenteDto,
  type ResolverSolicitudAntecedenteDto,
} from './dto/solicitud-antecedente.dto.js';

const ESTADOS = ['PENDIENTE', 'APROBADA', 'DENEGADA'] as const;

/**
 * F5 / T-52 · solicitud de antecedente.
 *
 * El personal de la sede no escribe el antecedente: pide que la plataforma lo
 * evalúe. La relación con la sede se demuestra con una reserva YA OCURRIDA
 * (cualquier estado, incluidas canceladas): una cita futura todavía no dice
 * nada del comportamiento del cliente. Una sola PENDIENTE por cliente y sede.
 */
@Injectable()
export class SolicitudAntecedenteService {
  private readonly logger = new Logger(SolicitudAntecedenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiempo: TiempoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Sede existente + rol de sede del solicitante (fail-closed). */
  private async exigirSedeYRol(usuarioId: string, barberiaId: string) {
    const sede = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { id: true, zonaHoraria: true },
    });

    if (!sede) {
      throw new NotFoundException('Barbería no encontrada');
    }

    const rol = await this.prisma.usuarioRol.findFirst({
      where: {
        usuarioId,
        barberiaId,
        estado: 'ACTIVO',
        rol: { nombre: { in: [ROL_ADMIN_BARBERIA, ROL_BARBERO] } },
      },
      select: { id: true, rol: { select: { nombre: true } } },
    });

    if (!rol) {
      throw errorDePermiso(
        'SIN_PERMISO_ANTECEDENTES',
        'Solo el ADMIN_BARBERIA o un BARBERO de la sede pueden pedir un antecedente.',
      );
    }

    return { sede, rolNombre: rol.rol?.nombre ?? ROL_BARBERO };
  }

  /**
   * Relación cliente–sede: al menos una reserva en esa sede cuyo inicio ya
   * pasó. Se compone el instante con la zona de la sede, no con la del servidor.
   */
  private async exigirRelacionConSede(
    clienteId: string,
    barberiaId: string,
    zonaHoraria: string,
  ): Promise<void> {
    const reservas = await this.prisma.reserva.findMany({
      where: { clienteId, barberiaId },
      select: { fechaCita: true, horaInicio: true },
    });

    const ahora = this.tiempo.ahora();
    const ocurrio = reservas.some((reserva) => {
      const inicio = this.tiempo.aInstante(
        fechaCalendarioISO(reserva.fechaCita),
        horaRelojHHMM(reserva.horaInicio),
        zonaHoraria,
      );
      return inicio.getTime() <= ahora.getTime();
    });

    if (!ocurrio) {
      throw reglaDeNegocio(
        'CLIENTE_SIN_RELACION_CON_SEDE',
        'El cliente no tiene ninguna cita ya ocurrida en esta sede: no se puede pedir un antecedente sobre él.',
        { clienteId, barberiaId },
      );
    }
  }

  async crear(usuarioId: string, barberiaId: string, dto: CrearSolicitudAntecedenteDto) {
    const { sede } = await this.exigirSedeYRol(usuarioId, barberiaId);

    const cliente = await this.prisma.usuario.findUnique({
      where: { id: dto.clienteId },
      select: { id: true },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    await this.exigirRelacionConSede(dto.clienteId, barberiaId, sede.zonaHoraria);

    const pendiente = await this.prisma.solicitudAntecedente.findFirst({
      where: { clienteId: dto.clienteId, barberiaId, estado: 'PENDIENTE' },
      select: { id: true },
    });

    if (pendiente) {
      throw errorDeConflicto(
        'SOLICITUD_ANTECEDENTE_PENDIENTE',
        'Ya hay una solicitud pendiente para este cliente en esta sede: espera a que la plataforma la resuelva.',
        { solicitudId: pendiente.id },
      );
    }

    const motivo = (dto.motivo ?? '').trim();
    if (motivo === '') {
      throw errorDeSolicitud('MOTIVO_REQUERIDO', 'El motivo de la solicitud es obligatorio.');
    }

    const evidenciaTexto = (dto.evidenciaTexto ?? '').trim() || null;

    try {
      const solicitud = await this.prisma.solicitudAntecedente.create({
        data: {
          barberiaId,
          solicitanteId: usuarioId,
          clienteId: dto.clienteId,
          motivo,
          evidenciaTexto,
          estado: 'PENDIENTE',
        },
        include: {
          solicitante: { select: { id: true, nombreCompleto: true } },
          cliente: { select: { id: true, nombreCompleto: true, correo: true } },
          barberia: { select: { id: true, nombre: true } },
        },
      });

      this.logger.log(
        `Solicitud de antecedente ${solicitud.id} creada en sede ${barberiaId} por ${usuarioId}`,
      );
      return solicitud;
    } catch (error: unknown) {
      // Carrera contra el índice único parcial: otra petición simultánea ganó.
      if ((error as { code?: string })?.code === 'P2002') {
        throw errorDeConflicto(
          'SOLICITUD_ANTECEDENTE_PENDIENTE',
          'Ya hay una solicitud pendiente para este cliente en esta sede: espera a que la plataforma la resuelva.',
        );
      }
      throw error;
    }
  }

  /**
   * Solicitudes de la sede. El ADMIN_BARBERIA ve todas las de su sede; el
   * BARBERO, solo las que él mismo pidió.
   */
  async listar(usuarioId: string, barberiaId: string, estado?: string) {
    const { rolNombre } = await this.exigirSedeYRol(usuarioId, barberiaId);

    if (estado !== undefined && !ESTADOS.includes(estado as (typeof ESTADOS)[number])) {
      throw errorDeSolicitud(
        'ESTADO_INVALIDO',
        'El estado debe ser PENDIENTE, APROBADA o DENEGADA.',
      );
    }

    return this.prisma.solicitudAntecedente.findMany({
      where: {
        barberiaId,
        ...(rolNombre === ROL_ADMIN_BARBERIA ? {} : { solicitanteId: usuarioId }),
        ...(estado ? { estado } : {}),
      },
      include: {
        solicitante: { select: { id: true, nombreCompleto: true } },
        cliente: { select: { id: true, nombreCompleto: true, correo: true } },
        barberia: { select: { id: true, nombre: true } },
      },
      orderBy: { creadoAt: 'desc' },
    });
  }

  /**
   * F5 / T-55 · clientes que el formulario puede ofrecer.
   *
   * Sale de las reservas de la sede, no de una lista global de cuentas: pedir
   * un antecedente exige relación previa, así que ofrecer a quien nunca pasó
   * por aquí solo llevaría a un 422. El BARBERO ve únicamente su agenda.
   */
  async listarClientes(usuarioId: string, barberiaId: string) {
    const { rolNombre } = await this.exigirSedeYRol(usuarioId, barberiaId);

    const reservas = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        ...(rolNombre === ROL_ADMIN_BARBERIA ? {} : { barberoId: usuarioId }),
      },
      select: {
        cliente: { select: { id: true, nombreCompleto: true, correo: true } },
      },
      distinct: ['clienteId'],
      orderBy: { clienteId: 'asc' },
    });

    return reservas.map((reserva) => reserva.cliente);
  }

  /**
   * F5 / T-53 · bandeja de la plataforma.
   *
   * Solo el ADMINISTRADOR global resuelve: la sede pide y no decide sobre su
   * propio reporte. El listado es transversal, sin sede en la ruta.
   */
  async listarPendientesGlobal(adminId: string) {
    if (!(await esAdministradorGlobalPorId(this.prisma, adminId))) {
      throw errorDePermiso(
        'SIN_PERMISO_ANTECEDENTES',
        'Solo el ADMINISTRADOR de la plataforma resuelve solicitudes de antecedente.',
      );
    }

    return this.prisma.solicitudAntecedente.findMany({
      where: { estado: 'PENDIENTE' },
      include: {
        solicitante: { select: { id: true, nombreCompleto: true } },
        cliente: { select: { id: true, nombreCompleto: true, correo: true } },
        barberia: { select: { id: true, nombre: true } },
      },
      orderBy: { creadoAt: 'asc' },
    });
  }

  /**
   * F5 / T-53 · aprobar o denegar.
   *
   * Aprobar y crear el antecedente ocurren en UNA transacción: si la copia a
   * `antecedentes` falla, la solicitud sigue PENDIENTE y se puede reintentar.
   * La auditoría se escribe con el mismo cliente transaccional.
   */
  async resolver(
    adminId: string,
    solicitudId: string,
    dto: ResolverSolicitudAntecedenteDto,
  ) {
    const solicitud = await this.prisma.solicitudAntecedente.findFirst({
      where: { id: solicitudId },
    });

    if (!solicitud) {
      throw new NotFoundException('Solicitud de antecedente no encontrada');
    }

    if (solicitud.estado !== 'PENDIENTE') {
      throw errorDeConflicto(
        'SOLICITUD_YA_RESUELTA',
        'La solicitud ya fue resuelta: no se decide dos veces.',
        { estado: solicitud.estado },
      );
    }

    const aprobar = dto.decision === DecisionSolicitudAntecedente.APROBAR;
    const motivoDecision = (dto.motivo ?? '').trim();

    if (!aprobar && motivoDecision === '') {
      throw reglaDeNegocio(
        'MOTIVO_REQUERIDO',
        'Explica por qué se deniega la solicitud: quien la pidió necesita saber el motivo.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (!aprobar) {
        const denegada = await tx.solicitudAntecedente.update({
          where: { id: solicitud.id },
          data: {
            estado: 'DENEGADA',
            resueltoPor: adminId,
            resueltoAt: new Date(),
            motivoDenegacion: motivoDecision,
          },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId: adminId,
            barberiaId: solicitud.barberiaId,
            accion: 'ANTECEDENTE_DENEGADO',
            entidad: 'solicitud_antecedente',
            entidadId: solicitud.id,
            contexto: {
              solicitudId: solicitud.id,
              clienteId: solicitud.clienteId,
              solicitanteId: solicitud.solicitanteId,
              motivo: motivoDecision,
            },
          },
          tx,
        );

        this.logger.log(`Solicitud de antecedente ${solicitud.id} denegada por ${adminId}`);
        return denegada;
      }

      // El `origen` del antecedente describe quién lo reportó: la sede (ADMIN)
      // o un barbero (BARBERO). Se resuelve con el rol vigente del solicitante
      // en esa sede, no con una suposición del cliente que llama.
      const rolSolicitante = await tx.usuarioRol.findFirst({
        where: {
          usuarioId: solicitud.solicitanteId,
          barberiaId: solicitud.barberiaId,
          estado: 'ACTIVO',
          rol: { nombre: ROL_ADMIN_BARBERIA },
        },
        select: { id: true },
      });

      const contenido = solicitud.evidenciaTexto
        ? `${solicitud.motivo}\n\n${solicitud.evidenciaTexto}`
        : solicitud.motivo;

      const antecedente = await tx.antecedente.create({
        data: {
          usuarioId: solicitud.clienteId,
          barberiaOrigenId: solicitud.barberiaId,
          categoria: 'GENERAL',
          contenido,
          origen: rolSolicitante ? 'ADMIN' : 'BARBERO',
          estadoValidacion: 'APROBADO',
          compartido: false,
        },
      });

      const aprobada = await tx.solicitudAntecedente.update({
        where: { id: solicitud.id },
        data: {
          estado: 'APROBADA',
          resueltoPor: adminId,
          resueltoAt: new Date(),
          motivoDenegacion: null,
        },
      });

      await this.auditoria.registrarEvento(
        {
          usuarioId: adminId,
          barberiaId: solicitud.barberiaId,
          accion: 'ANTECEDENTE_APROBADO',
          entidad: 'solicitud_antecedente',
          entidadId: solicitud.id,
          contexto: {
            solicitudId: solicitud.id,
            antecedenteId: antecedente.id,
            clienteId: solicitud.clienteId,
            solicitanteId: solicitud.solicitanteId,
          },
        },
        tx,
      );

      this.logger.log(`Solicitud de antecedente ${solicitud.id} aprobada por ${adminId}`);
      return aprobada;
    });
  }
}
