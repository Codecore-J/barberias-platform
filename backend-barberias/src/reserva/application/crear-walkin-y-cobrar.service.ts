import { Injectable, Logger } from '@nestjs/common';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ACTORES, ESTADOS, type EstadoReserva } from '../../shared/domain/estados.js';
import { ReservaStateMachine } from '../../shared/domain/reserva-state-machine.js';
import { EVENTOS_RESERVA } from '../../notificaciones/domain/eventos-reserva.js';
import type { MetodoPago } from '../../pago/domain/metodos-pago.js';
import { PagoService } from '../../pago/application/pago.service.js';
import { RegistrarPagoDto } from '../../pago/application/dto/registrar-pago.dto.js';
import { CreateReservaDto } from './dto/create-reserva.dto.js';
import { ReservaService } from './reserva.service.js';

/** Recibo combinado que devuelve la cita directa: la cita y su cobro. */
export interface ReciboWalkIn {
  reserva: Awaited<ReturnType<ReservaService['crearReserva']>>;
  pago: Awaited<ReturnType<PagoService['registrarPagoEnPersona']>>['pago'];
}

/**
 * Fase 3 · cita directa (walk-in) cobrada en un solo paso.
 *
 * El cajero atiende a alguien que llega sin cita: elige barbero, servicio y hora,
 * y cobra en el mismo gesto. Hacerlo con dos peticiones —`POST /walk-in` y luego
 * `POST /pagos/cobrar`— deja dos huecos que ya se han visto en producción:
 *
 *   1. **La cita queda sin cobrar.** Si el segundo envío no sale (red, pestaña
 *      cerrada, el cajero se distrae), hay una cita COMPLETADA o CONFIRMADA que
 *      nadie pagó, y el arqueo del día no cuadra con lo que hay en el cajón.
 *   2. **El cobro queda huérfano.** Si la cita sí se creó pero el pago falló,
 *      reintentar el cobro desde Pagos es la única salida, y nada en la pantalla
 *      dice que ese paso quedó a medias.
 *
 * Aquí las dos escrituras comparten UNA transacción SERIALIZABLE: o quedan las
 * dos, o no queda ninguna. La reserva entra por el MISMO camino que cualquier
 * otra alta —`ReservaService.crearReserva` con su comprobación de disponibilidad
 * bajo `FOR UPDATE`—, así que no existe una segunda regla de agenda que pueda
 * divergir de la primera.
 *
 * Por eso `crearReserva` y `registrarPagoEnPersona` aceptan una transacción
 * externa: sin eso, cada uno abriría la suya (Prisma no anida transacciones) y
 * la atomicidad sería decorativa.
 */
@Injectable()
export class CrearWalkInYCobrarService {
  private readonly logger = new Logger(CrearWalkInYCobrarService.name);

  constructor(
    private readonly reservaService: ReservaService,
    private readonly pagoService: PagoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Crea la cita ya confirmada y la cobra con el método indicado.
   *
   * `usuarioId` es quien opera el mostrador: es el creador de la cita y el
   * `registradoPor` del cobro, así que la auditoría nombra a la persona correcta.
   */
  async ejecutar(
    usuarioId: string,
    barberiaId: string,
    dataReserva: CreateReservaDto,
    metodoPago: MetodoPago,
  ): Promise<ReciboWalkIn> {
    const recibo = await withSerializableTransaction(this.prisma, async (tx) => {
      // 1. Alta. Nace CONFIRMADA: el cajero ya tiene al cliente delante, así que
      //    el temporizador de aceptación de las sedes en modo MANUAL no aplica.
      const reserva = await this.reservaService.crearReserva(usuarioId, barberiaId, dataReserva, {
        tx,
        confirmarAlCrear: true,
      });

      // 2. Contrato de la máquina de estados (§5.2 fila 11): el STAFF solo puede
      //    cobrar desde CONFIRMADA. Se afirma sobre la fila que acaba de nacer y
      //    no sobre una suposición: si el alta dejara otro estado, esto revienta
      //    aquí, dentro de la transacción, y no después con un cobro a medias.
      //    La escritura del paso a COMPLETADA la hace el cobro, para que exista
      //    un único lugar que cierre la cita.
      ReservaStateMachine.assertTransition(
        reserva.estado as EstadoReserva,
        ESTADOS.COMPLETADA,
        ACTORES.STAFF,
      );

      // 3. Cobro sobre la misma transacción. Sin `monto`: `registrarPagoEnPersona`
      //    cobra el total congelado de los servicios de la reserva y rechaza con
      //    `MONTO_NO_COINCIDE` cualquier otra cifra.
      const cobroDto: RegistrarPagoDto = { reservaId: reserva.id, metodoPago };
      const cobro = await this.pagoService.registrarPagoEnPersona(
        usuarioId,
        barberiaId,
        cobroDto,
        { tx },
      );

      return { reserva: cobro.reserva, pago: cobro.pago };
    });

    // 4. Evento de dominio, ya con la transacción confirmada. `crearReserva` no
    //    lo publica cuando corre dentro de una transacción ajena: anunciar una
    //    cita cuyo cobro puede abortar el flujo entero sería un aviso de algo que
    //    no existe.
    await this.reservaService.publicarEventoReserva(EVENTOS_RESERVA.CONFIRMADA, recibo.reserva.id);

    this.logger.log(
      `Walk-in ${recibo.reserva.id} creado y cobrado (pago ${recibo.pago.id}, ${metodoPago}) en ${barberiaId} por ${usuarioId}`,
    );

    return recibo;
  }
}
