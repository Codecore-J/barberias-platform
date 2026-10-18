import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { ACTORES, ESTADOS, type EstadoReserva } from '../../shared/domain/estados.js';
import { ReservaStateMachine } from '../../shared/domain/reserva-state-machine.js';
import { errorDeConflicto, errorDePermiso, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import {
  TiempoService,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import { RegistrarPagoDto } from './dto/registrar-pago.dto.js';
import { AnularPagoDto } from './dto/anular-pago.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { esAdministradorGlobal, esAdministradorGlobalPorId } from '../../iam/domain/roles.js';

@Injectable()
export class PagoService {
  private readonly logger = new Logger(PagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoriaService: AuditoriaService,
    // E2-04: el «ahora» de la ventana de cobro sale del reloj central, no de
    // `new Date()` repartido por el servicio.
    private readonly tiempo: TiempoService,
  ) {}

  /**
   * Perfil con el que se paga: `ADMIN` accede sin restricción de asignación
   * (responsable, ADMINISTRADOR global o ADMIN_BARBERIA de la sede) y `BARBERO`
   * queda sujeto a E3-09, que exige que la reserva esté asignada a él.
   */
  private async validateAccess(
    usuarioId: string,
    barberiaId: string,
  ): Promise<'ADMIN' | 'BARBERO'> {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    if (barberia.responsableId === usuarioId) {
      return 'ADMIN';
    }

    // E1-04 (D05): el rol global es ADMINISTRADOR.
    if (await esAdministradorGlobalPorId(this.prisma, usuarioId)) {
      return 'ADMIN';
    }

    const rolesUser = (await this.prisma.usuarioRol.findMany({
      where: { usuarioId, barberiaId },
      include: { rol: true },
    })) ?? [];

    // E3-09: el ADMIN_BARBERIA de la sede conserva su bypass; el que queda
    // restringido a "solo las suyas" es el que entra por el rol BARBERO.
    if (rolesUser.some((ur) => ur.rol?.nombre === 'ADMIN_BARBERIA')) {
      return 'ADMIN';
    }

    if (rolesUser.some((ur) => ur.rol?.nombre === 'BARBERO')) {
      return 'BARBERO';
    }

    throw new ForbiddenException(
      'No tienes permisos para registrar pagos en esta barbería',
    );
  }

  /**
   * Registra el pago en persona de una reserva de forma atómica y auditable.
   * Regla de Negocio T6.1:
   * - Transición de estado: PENDIENTE_DE_PAGO / null -> PAGADA
   * - Reserva pasa a COMPLETADA **por la máquina de estados** y solo desde
   *   `CONFIRMADA`, con `ahora >= hora_inicio` (E3-09, §5.2 fila 11; H47)
   * - `reservas.completada_at` queda fijado con el «ahora» del reloj central
   * - Registro inmutable en auditoría
   */
  async registrarPagoEnPersona(
    usuarioId: string,
    barberiaId: string,
    dto: RegistrarPagoDto,
  ) {
    let targetBarberiaId = barberiaId;
    if (!targetBarberiaId) {
      const reservaPrevia = await this.prisma.reserva.findUnique({
        where: { id: dto.reservaId },
        select: { barberiaId: true },
      });
      if (!reservaPrevia) {
        throw new NotFoundException(
          `Reserva con ID ${dto.reservaId} no encontrada`,
        );
      }
      targetBarberiaId = reservaPrevia.barberiaId;
    }

    const perfil = await this.validateAccess(usuarioId, targetBarberiaId);

    return withSerializableTransaction(this.prisma, async (tx) => {
      // Bloqueo pesimista para evitar que dos cajeros cobren la misma reserva simultáneamente
      const reserva = await tx.reserva.findFirst({
        where: {
          id: dto.reservaId,
          barberiaId: targetBarberiaId,
        },
        include: {
          pago: true,
          // E3-09: para decidir si la cita ya empezó hace falta la zona de la
          // SEDE (E2-04). Sin ella el instante se compondría con la del servidor
          // y la condición de `hora_inicio` se cumpliría horas antes o después.
          barberia: { select: { zonaHoraria: true } },
        },
      });

      if (!reserva) {
        throw new NotFoundException(
          `Reserva con ID ${dto.reservaId} no encontrada en esta barbería`,
        );
      }

      // E3-09: un BARBERO solo cobra las reservas que tiene asignadas. El
      // check va aquí y no en `validateAccess` porque necesita la reserva
      // concreta, y dentro de la transacción para que lea y juzgue la misma
      // fila que después actualiza. Las reservas sin asignar (barberoId nulo)
      // solo las cobra un ADMIN: deben asignarse antes de pasar por caja.
      if (perfil === 'BARBERO') {
        if (!reserva.barberoId) {
          throw new ForbiddenException(
            'La reserva no tiene barbero asignado: debe asignarse antes de cobrarla',
          );
        }
        if (reserva.barberoId !== usuarioId) {
          throw new ForbiddenException(
            'Solo puedes cobrar reservas asignadas a ti',
          );
        }
      }

      // Cobrar dos veces la misma reserva se responde antes que nada y con su
      // propio mensaje: es el caso más frecuente en caja.
      if (reserva.pago && reserva.pago.estadoPago === 'PAGADA') {
        throw new ConflictException('Esta reserva ya fue pagada previamente');
      }

      // H68 · §7.3: un cobro ANULADO devuelve la reserva a la caja. La reserva ya
      // está COMPLETADA —el servicio se prestó—, así que no hay transición que
      // pedirle a la máquina: lo que se corrige es el PAGO. Es el ÚNICO caso que
      // salta el paso por la máquina; cualquier otro estado sigue pasando por
      // ella, y mientras el cobro siga `PAGADA` el guard de arriba lo rechaza.
      const reanudandoTrasAnulacion =
        reserva.estado === ESTADOS.COMPLETADA && reserva.pago?.estadoPago === 'ANULADO';

      // E3-09 §5.2 (fila 11): CONFIRMADA → COMPLETADA la ejecuta el STAFF «desde
      // hora_inicio». La máquina decide QUÉ transiciones valen —una PENDIENTE,
      // CANCELADA, EXPIRADA o NO_PRESENTADA ya no se completa: 409
      // ESTADO_INVALIDO— y la condición de TIEMPO se añade justo después, porque
      // la máquina es pura y no conoce el reloj (H47: antes se escribía
      // `COMPLETADA` con un `update` directo, sin máquina y sin hora).
      if (!reanudandoTrasAnulacion) {
        ReservaStateMachine.assertTransition(
          reserva.estado as EstadoReserva,
          ESTADOS.COMPLETADA,
          ACTORES.STAFF,
        );
      }

      const inicioCita = this.tiempo.aInstante(
        fechaCalendarioISO(reserva.fechaCita),
        horaRelojHHMM(reserva.horaInicio),
        reserva.barberia.zonaHoraria,
      );

      if (this.tiempo.ahora().getTime() < inicioCita.getTime()) {
        throw reglaDeNegocio(
          'CITA_NO_INICIADA',
          `No se puede cobrar una cita que aún no ha comenzado: está agendada para las ${horaRelojHHMM(reserva.horaInicio)}.`,
        );
      }

      const montoFinal = dto.monto ?? Number(reserva.totalPagar);
      const metodoPago = dto.metodoPago ?? 'EN_PERSONA';

      // 1. Crear o actualizar registro de Pago. La reanudación de un cobro
      //    anulado vuelve a PAGADA sobre la MISMA fila: el `reserva_id` es
      //    único, así que no puede nacer un segundo cobro de la misma reserva.
      //    Los campos de la anulación se limpian porque la fila cuenta su estado
      //    vigente; el historial de anulaciones vive en la auditoría, que es
      //    inmutable.
      const pago = await tx.pago.upsert({
        where: { reservaId: reserva.id },
        create: {
          reservaId: reserva.id,
          estadoPago: 'PAGADA',
          monto: montoFinal,
          metodoPago,
          registradoPor: usuarioId,
        },
        update: {
          estadoPago: 'PAGADA',
          monto: montoFinal,
          metodoPago,
          registradoPor: usuarioId,
          actualizadoAt: new Date(),
          anuladoAt: null,
          anuladoPor: null,
          motivoAnulacion: null,
        },
      });

      // 2. Marcar la reserva como COMPLETADA y fijar el instante del cierre
      //    (`reservas.completada_at`, E2-03/E3-09). Reanudar un cobro anulado NO
      //    reescribe ese instante: la reserva ya cerró cuando se prestó el
      //    servicio, y moverlo falsearía la antigüedad del cierre.
      const reservaActualizada = reanudandoTrasAnulacion
        ? reserva
        : await tx.reserva.update({
            where: { id: reserva.id },
            data: { estado: ESTADOS.COMPLETADA, completadaAt: this.tiempo.ahora() },
          });

      // 3. Auditoría obligatoria delegada formalmente a AuditoriaService (AUDIT-01 / T6.1)
      await this.auditoriaService.registrarEvento(
        {
          usuarioId,
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          entidadId: pago.id,
          contexto: {
            reservaId: reserva.id,
            monto: montoFinal,
            metodo: metodoPago,
            clienteId: reserva.clienteId,
            barberiaId,
            fechaPago: new Date().toISOString(),
            estadoPrevioPago: reserva.pago?.estadoPago ?? 'PENDIENTE_DE_PAGO',
            nuevoEstadoPago: 'PAGADA',
            estadoReserva: ESTADOS.COMPLETADA,
          },
        },
        tx,
      );

      this.logger.log(
        `Pago ${pago.id} registrado para reserva ${reserva.id} por usuario ${usuarioId} (Monto: $${montoFinal})`,
      );

      return {
        pago,
        reserva: reservaActualizada,
      };
    });
  }

  /**
   * H68 · §7.3: corrige un cobro ANULÁNDOLO.
   *
   * Decisiones que fija este método:
   *
   *  - **No se borra nada.** La firma del proyecto prohíbe el `DELETE` para
   *    representar un cambio de estado: la fila pasa a `ANULADO` con autor, fecha
   *    y motivo, y la reserva conserva su `COMPLETADA` (el servicio se prestó).
   *  - **Solo la SEDE anula.** El barbero cobra lo suyo (E3-09), pero deshacer un
   *    ingreso es una decisión administrativa: `validateAccess` devuelve
   *    `BARBERO` para él y aquí se rechaza con 403.
   *  - **Anular dos veces no es idempotente.** Responde 409 `ESTADO_INVALIDO`,
   *    como desvincular dos veces o resolver una solicitud ya resuelta: cada
   *    anulación intenta mover dinero, y una repetición tiene que doler.
   *  - **Solo se anula lo que se cobró.** Un pago `PENDIENTE_DE_PAGO` nunca fue
   *    ingreso (§7.4): no hay nada que deshacer y también es 409.
   *  - **El estado se juzga sobre la fila que se escribe.** La lectura previa solo
   *    resuelve de qué sede es el cobro; la comprobación de estado y el `UPDATE`
   *    ocurren dentro de la transacción SERIALIZABLE, como el alta (D37/§10.3).
   */
  async anularPago(
    usuarioId: string,
    barberiaId: string | null,
    pagoId: string,
    dto: AnularPagoDto,
  ) {
    const motivo = dto?.motivo?.trim();
    if (!motivo) {
      throw reglaDeNegocio(
        'MOTIVO_REQUERIDO',
        'Anular un cobro exige un motivo: queda registrado en la auditoría.',
      );
    }

    // Lectura previa: solo para saber de qué sede es el cobro y quién manda ahí.
    const previo = await this.prisma.pago.findUnique({
      where: { id: pagoId },
      include: { reserva: { select: { id: true, barberiaId: true } } },
    });

    if (!previo) {
      throw new NotFoundException(`Pago ${pagoId} no encontrado.`);
    }

    // El alias con `:barberiaId` (barberias/:barberiaId/pagos/...) no puede
    // alcanzar el cobro de otra sede. Se responde 404 y no 403 a propósito: un 403
    // confirmaría que ese cobro existe en otra sede.
    if (barberiaId && previo.reserva.barberiaId !== barberiaId) {
      throw new NotFoundException(`Pago ${pagoId} no encontrado en esta barbería.`);
    }

    const sedeDelPago = previo.reserva.barberiaId;
    const perfil = await this.validateAccess(usuarioId, sedeDelPago);

    if (perfil !== 'ADMIN') {
      throw errorDePermiso(
        'ANULACION_SOLO_ADMIN',
        'Solo la sede administra sus cobros: un barbero puede cobrar, no anular.',
      );
    }

    return withSerializableTransaction(this.prisma, async (tx) => {
      const pago = await tx.pago.findUnique({
        where: { id: pagoId },
        include: { reserva: { select: { id: true, barberiaId: true } } },
      });

      if (!pago) {
        throw new NotFoundException(`Pago ${pagoId} no encontrado.`);
      }

      if (pago.estadoPago === 'ANULADO') {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          'Este cobro ya está anulado: la anulación no se repite.',
        );
      }

      if (pago.estadoPago !== 'PAGADA') {
        throw errorDeConflicto(
          'ESTADO_INVALIDO',
          `Solo se anula un cobro registrado: este pago está ${pago.estadoPago}.`,
        );
      }

      const ahora = this.tiempo.ahora();

      const anulado = await tx.pago.update({
        where: { id: pagoId },
        data: {
          estadoPago: 'ANULADO',
          anuladoAt: ahora,
          anuladoPor: usuarioId,
          motivoAnulacion: motivo,
          actualizadoAt: ahora,
        },
      });

      // D28 / §8.3: la corrección de un ingreso deja rastro DENTRO de la
      // transacción, con el motivo del DTO y el estado previo real.
      await this.auditoriaService.registrarEvento(
        {
          usuarioId,
          accion: 'PAGO_ANULADO',
          entidad: 'PAGO',
          entidadId: pagoId,
          contexto: {
            reservaId: pago.reserva.id,
            barberiaId: pago.reserva.barberiaId,
            monto: Number(pago.monto),
            motivo,
            estadoPrevioPago: pago.estadoPago,
            nuevoEstadoPago: 'ANULADO',
            fechaAnulacion: ahora.toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `Pago ${pagoId} anulado por usuario ${usuarioId} (motivo: ${motivo})`,
      );

      return anulado;
    });
  }

  /**
   * H68 · el historial de cobros de la sede (el recibo).
   *
   * Sale de `pagos` y no del registro de auditoría: el recibo necesita el ESTADO
   * VIVO del cobro —incluido `ANULADO`— y su `id`, que es lo que permite
   * corregirlo. La auditoría sigue siendo el rastro inmutable (§7.1) y se sigue
   * consultando por `obtenerAuditoriaPagos`.
   *
   * Mismo aislamiento que la auditoría (E1-02/H18): barbería obligatoria para
   * quien no es ADMINISTRADOR y `validateAccess` sobre ella; el `where` filtra por
   * sede en la CONSULTA, nunca en memoria.
   */
  async listarHistorial(
    usuario: UsuarioAutenticado,
    barberiaId: string | null,
    page = 1,
    pageSize = 50,
  ) {
    const esGlobal = esAdministradorGlobal(usuario);

    if (!barberiaId && !esGlobal) {
      throw new BadRequestException(
        'Debes indicar la barbería (ruta /barberias/:barberiaId/pagos/historial o cabecera x-barberia-id) para consultar el historial de cobros.',
      );
    }

    if (barberiaId) {
      await this.validateAccess(usuario.id, barberiaId);
    }

    const tamano = Math.min(Math.max(pageSize, 1), 100);
    const paginaActual = Math.max(page, 1);
    const where = barberiaId ? { reserva: { barberiaId } } : {};

    const [total, filas] = await Promise.all([
      this.prisma.pago.count({ where }),
      this.prisma.pago.findMany({
        where,
        orderBy: { registradoAt: 'desc' },
        take: tamano,
        skip: (paginaActual - 1) * tamano,
        include: {
          registrador: { select: { id: true, nombreCompleto: true, correo: true } },
          anulador: { select: { id: true, nombreCompleto: true, correo: true } },
          reserva: {
            select: {
              id: true,
              estado: true,
              fechaCita: true,
              horaInicio: true,
              horaFin: true,
              cliente: { select: { id: true, nombreCompleto: true } },
              participantes: {
                select: {
                  servicios: {
                    select: {
                      // El precio es el HISTÓRICO de la reserva, no el del
                      // catálogo de hoy (los precios confirmados se congelan).
                      precioHistorico: true,
                      servicio: { select: { nombre: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: filas.map((fila) => this.aRecibo(fila)),
      total,
      page: paginaActual,
      pageSize: tamano,
    };
  }

  /**
   * Fila de `pagos` → recibo que consume la pantalla. Las fechas de la cita son
   * ETIQUETAS (DATE + TIME), así que se leen con los helpers de tiempo y no con
   * la zona del servidor (E2-04/H36).
   */
  private aRecibo(fila: any) {
    return {
      id: fila.id,
      reservaId: fila.reservaId,
      estadoPago: fila.estadoPago,
      estadoReserva: fila.reserva?.estado ?? null,
      monto: Number(fila.monto),
      metodoPago: fila.metodoPago,
      registradoAt: fila.registradoAt ? fila.registradoAt.toISOString() : null,
      registradoPor: fila.registrador ?? null,
      anuladoAt: fila.anuladoAt ? fila.anuladoAt.toISOString() : null,
      anuladoPor: fila.anulador ?? null,
      motivoAnulacion: fila.motivoAnulacion ?? null,
      cita: {
        fecha: fila.reserva ? fechaCalendarioISO(fila.reserva.fechaCita) : null,
        horaInicio: fila.reserva ? horaRelojHHMM(fila.reserva.horaInicio) : null,
        horaFin: fila.reserva ? horaRelojHHMM(fila.reserva.horaFin) : null,
      },
      cliente: fila.reserva?.cliente ?? null,
      servicios: (fila.reserva?.participantes ?? [])
        .flatMap((participante: any) => participante.servicios ?? [])
        .map((linea: any) => ({
          nombre: linea.servicio?.nombre ?? 'Servicio',
          precio: Number(linea.precioHistorico ?? 0),
        })),
    };
  }

  /**
   * Consulta los registros de auditoría de pagos para una barbería específica.
   */
  async obtenerAuditoriaPagos(
    usuario: UsuarioAutenticado,
    barberiaId: string | null,
    page = 1,
    pageSize = 50,
  ) {
    const esGlobal = esAdministradorGlobal(usuario);

    // E1-02: mismo criterio que GET /auditoria. Sin barbería y sin ser
    // ADMINISTRADOR, 400 antes de tocar la base.
    if (!barberiaId && !esGlobal) {
      throw new BadRequestException(
        'Debes indicar la barbería (ruta /barberias/:barberiaId/cobros/auditoria o cabecera x-barberia-id) para consultar la auditoría.',
      );
    }

    if (barberiaId) {
      await this.validateAccess(usuario.id, barberiaId);
    }

    return this.auditoriaService.consultarAuditorias(
      {
        entidad: 'PAGO',
        accion: 'REGISTRO_PAGO_EN_PERSONA',
        barberiaId: barberiaId ?? undefined,
        page,
        pageSize,
      },
      usuario,
    );
  }
}
