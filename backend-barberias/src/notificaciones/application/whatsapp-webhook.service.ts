import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ReservaService } from '../../reserva/application/reserva.service.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import { type UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import { telefonosCoinciden } from '../domain/telefono.js';
import {
  type AccionWebhook,
  type ResponderRecordatorioDto,
} from './dto/responder-recordatorio.dto.js';

export interface ResultadoWebhook {
  ok: true;
  accion: AccionWebhook;
  reservaId: string;
  estado: string;
  /**
   * `true` cuando el estado pedido ya estaba alcanzado: la respuesta sigue
   * siendo 200 porque el cliente obtuvo exactamente lo que pidió (un doble
   * «CONFIRMAR» tecleado no es un error).
   */
  sinTransicion?: boolean;
}

/**
 * Fase 7 · webhook de retención: el cliente responde al recordatorio desde su
 * WhatsApp y eso mueve la reserva.
 *
 * El camino es el mismo que usa la sede, no una transición paralela:
 *
 *  - `CONFIRMAR` → `ReservaService.aceptarReserva`, que revalida la
 *    disponibilidad (el hueco pudo ocuparse), cierra el temporizador de
 *    expiración, audita con la identidad de quien respondió y publica
 *    `reserva.confirmada`. En §5.2 esa fila es `PENDIENTE → CONFIRMADA`; el
 *    webhook no inventa un actor nuevo, ejecuta la transición que ya existe.
 *  - `CANCELAR` → `ReservaService.cancelarReserva`, con todas sus reglas:
 *    ventana de §5.7 para una CONFIRMADA, liberación del hueco para la lista de
 *    espera y publicación de `reserva.cancelada`.
 *
 * La pertenencia se comprueba ANTES de tocar nada: el secreto protege la puerta
 * del webhook, pero el teléfono que viene en el payload tiene que ser el del
 * cliente dueño de la reserva.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservas: ReservaService,
  ) {}

  async responder(dto: ResponderRecordatorioDto): Promise<ResultadoWebhook> {
    const reserva = await this.prisma.reserva.findUnique({
      where: { id: dto.reservaId },
      select: {
        id: true,
        barberiaId: true,
        clienteId: true,
        estado: true,
        cliente: { select: { id: true, nombreCompleto: true, telefono: true } },
      },
    });

    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }

    if (!telefonosCoinciden(dto.telefono, reserva.cliente.telefono)) {
      this.logger.warn(
        `Webhook de WhatsApp: el teléfono del payload no corresponde al cliente de la reserva ${reserva.id}`,
      );
      throw new ForbiddenException(
        'El teléfono no corresponde al cliente de esta reserva.',
      );
    }

    // Estado ya alcanzado: no se reejecuta la transición (doble respuesta del
    // cliente) pero tampoco se le contesta un error por algo que pidió bien.
    if (dto.accion === 'CONFIRMAR' && reserva.estado === ESTADOS.CONFIRMADA) {
      return this.sinTransicion(dto, reserva.id, reserva.estado);
    }
    if (dto.accion === 'CANCELAR' && reserva.estado === ESTADOS.CANCELADA) {
      return this.sinTransicion(dto, reserva.id, reserva.estado);
    }

    const usuario = await this.usuarioDeCliente(reserva.clienteId);

    const resultado =
      dto.accion === 'CONFIRMAR'
        ? await this.reservas.aceptarReserva(reserva.barberiaId, reserva.id, usuario)
        : await this.reservas.cancelarReserva(reserva.barberiaId, reserva.id, usuario);

    this.logger.log(
      `Webhook de WhatsApp: ${dto.accion} sobre la reserva ${reserva.id} → ${resultado.estado}`,
    );

    return {
      ok: true,
      accion: dto.accion,
      reservaId: reserva.id,
      estado: resultado.estado,
    };
  }

  private sinTransicion(
    dto: ResponderRecordatorioDto,
    reservaId: string,
    estado: string,
  ): ResultadoWebhook {
    this.logger.log(
      `Webhook de WhatsApp: ${dto.accion} sobre la reserva ${reservaId} sin transición (ya en ${estado})`,
    );
    return {
      ok: true,
      accion: dto.accion,
      reservaId,
      estado,
      sinTransicion: true,
    };
  }

  /**
   * Identidad del cliente tal como la construye `JwtStrategy.validate`: las
   * reglas de cancelación y de propiedad de `ReservaService` leen
   * `rolesDetallados`, y un CLIENTE es de ámbito GLOBAL (`barberiaId` nulo), así
   * que el alcance cumple contra la sede de la reserva.
   *
   * La cuenta suspendida no puede operar por webhook: es el mismo criterio que
   * impide iniciar sesión.
   */
  private async usuarioDeCliente(clienteId: string): Promise<UsuarioAutenticado> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: clienteId },
      select: {
        id: true,
        correo: true,
        estadoCuenta: true,
        usuarioRoles: {
          select: {
            barberiaId: true,
            rol: { select: { nombre: true, ambito: true } },
          },
        },
      },
    });

    if (!usuario || usuario.estadoCuenta !== 'ACTIVO') {
      throw new UnauthorizedException(
        'La cuenta del cliente no está activa; no se puede ejecutar la acción.',
      );
    }

    const rolesDetallados = usuario.usuarioRoles.map((ur) => ({
      nombre: ur.rol.nombre,
      barberiaId: ur.barberiaId,
      ambito: ur.rol.ambito,
    }));

    return {
      id: usuario.id,
      correo: usuario.correo,
      roles: Array.from(new Set(rolesDetallados.map((rol) => rol.nombre))),
      rolesDetallados,
    };
  }
}