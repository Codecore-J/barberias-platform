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
import { RegistrarPagoDto } from './dto/registrar-pago.dto.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';

@Injectable()
export class PagoService {
  private readonly logger = new Logger(PagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoriaService: AuditoriaService,
  ) {}

  private async validateAccess(usuarioId: string, barberiaId: string) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    if (barberia.responsableId === usuarioId) {
      return;
    }

    const isSuperAdmin = await this.prisma.usuarioRol.findFirst({
      where: { usuarioId, rol: { nombre: 'SUPER_ADMIN' } },
    });

    if (isSuperAdmin) {
      return;
    }

    const rolesUser = (await this.prisma.usuarioRol.findMany({
      where: { usuarioId, barberiaId },
      include: { rol: true },
    })) ?? [];

    const hasAllowedRole = rolesUser.some((ur) =>
      ['ADMIN_BARBERIA', 'BARBERO'].includes(ur.rol?.nombre),
    );

    if (!hasAllowedRole) {
      throw new ForbiddenException(
        'No tienes permisos para registrar pagos en esta barbería',
      );
    }
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

    await this.validateAccess(usuarioId, targetBarberiaId);

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

      if (['CANCELADA', 'NO_ASISTIO', 'EXPIRADA'].includes(reserva.estado)) {
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
        data: { estado: 'COMPLETADA' },
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
            estadoReserva: 'COMPLETADA',
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
    usuarioId: string,
    barberiaId: string,
    limite = 50,
    offset = 0,
  ) {
    await this.validateAccess(usuarioId, barberiaId);

    return this.auditoriaService.consultarAuditorias({
      entidad: 'PAGO',
      accion: 'REGISTRO_PAGO_EN_PERSONA',
      barberiaId,
      limite,
      offset,
    });
  }
}
