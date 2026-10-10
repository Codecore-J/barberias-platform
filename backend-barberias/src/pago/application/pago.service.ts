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
import { ESTADOS } from '../../shared/domain/estados.js';
import { RegistrarPagoDto } from './dto/registrar-pago.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { esAdministradorGlobal, esAdministradorGlobalPorId } from '../../iam/domain/roles.js';

@Injectable()
export class PagoService {
  private readonly logger = new Logger(PagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoriaService: AuditoriaService,
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
   * - Reserva pasa a COMPLETADA
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

      // E2-02: mismos estados de antes desde el catálogo único de §5.1
      // (`NO_ASISTIO` → `NO_PRESENTADO`, H45). La transición a `COMPLETADA`
      // sigue escribiéndose aquí sin pasar por la máquina: queda para E3-09, que
      // es la tarea que añade la condición de `hora_inicio`.
      const estadosNoCobrables: readonly string[] = [
        ESTADOS.CANCELADA,
        ESTADOS.NO_PRESENTADO,
        ESTADOS.EXPIRADA,
      ];

      if (estadosNoCobrables.includes(reserva.estado)) {
        throw new BadRequestException(
          `No se puede cobrar una reserva en estado ${reserva.estado}`,
        );
      }

      if (reserva.pago && reserva.pago.estadoPago === 'PAGADA') {
        throw new ConflictException('Esta reserva ya fue pagada previamente');
      }

      const montoFinal = dto.monto ?? Number(reserva.totalPagar);

      // 1. Crear o actualizar registro de Pago
      const pago = await tx.pago.upsert({
        where: { reservaId: reserva.id },
        create: {
          reservaId: reserva.id,
          estadoPago: 'PAGADA',
          monto: montoFinal,
          registradoPor: usuarioId,
        },
        update: {
          estadoPago: 'PAGADA',
          monto: montoFinal,
          registradoPor: usuarioId,
          actualizadoAt: new Date(),
        },
      });

      // 2. Marcar la reserva como COMPLETADA
      const reservaActualizada = await tx.reserva.update({
        where: { id: reserva.id },
        data: { estado: ESTADOS.COMPLETADA },
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
            metodo: dto.metodoPago ?? 'EN_PERSONA',
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
