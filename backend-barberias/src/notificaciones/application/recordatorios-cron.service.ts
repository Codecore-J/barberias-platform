import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  TiempoService,
  ZONA_POR_DEFECTO,
  fechaCalendarioISO,
  horaRelojHHMM,
} from '../../shared/time/tiempo.service.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import {
  EVENTOS_RESERVA,
  HORAS_ANTELACION_RECORDATORIO,
  type EventoReserva,
} from '../domain/eventos-reserva.js';

/**
 * Fase 7 · Recordatorios preventivos (la palanca contra el no-show).
 *
 * Cada 15 minutos barre las reservas vivas cuya cita empieza dentro de las
 * próximas 2 horas y todavía no han recibido aviso, las marca y publica
 * `reserva.recordatorio`. El desfase de hasta 15 minutos es deliberado: el aviso
 * llega entre 1 h 45 min y 2 h antes, que es margen suficiente para que el
 * cliente cancele a tiempo.
 *
 * Tres decisiones que importan:
 *
 *  1. **La marca se escribe ANTES de emitir**, con un `updateMany` condicionado
 *     a `recordatorio_enviado = false`. Si dos instancias del API (o dos ticks
 *     solapados) encuentran la misma reserva, solo una gana el `count === 1`; la
 *     otra se retira. Es idempotencia en la base, no en memoria.
 *  2. **El instante se compone con la zona de la SEDE** (E2-04/H36):
 *     `fecha_cita` y `hora_inicio` son etiquetas, y comparar contra el reloj del
 *     servidor habría avisado 4 horas antes o después según dónde corra Render.
 *  3. **Un error no mata el barrido**: se registra y se sigue con la siguiente
 *     reserva. Un cron que lanza deja el resto del lote sin avisar.
 */
/**
 * Cada 15 minutos, en formato de 6 campos (segundos incluidos).
 *
 * @nestjs/schedule 12 ya no expone `CronExpression.EVERY_15_MINUTES` —su enum
 * salta de 10 a 30 minutos—, así que la constante vive aquí en vez de usar una
 * expresión literal suelta en el decorador: sigue habiendo un solo sitio donde
 * se lee la cadencia del barrido.
 */
export const CADA_15_MINUTOS = '0 */15 * * * *';

@Injectable()
export class RecordatoriosCronService {
  private readonly logger = new Logger(RecordatoriosCronService.name);

  /** Evita que dos ejecuciones se pisen DENTRO de la misma instancia. */
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    // Reloj inyectable: las pruebas fijan «ahora» y el barrido es determinista.
    @Optional() private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

  /**
   * Devuelve cuántos avisos se emitieron. El valor no lo usa el scheduler, pero
   * sí las pruebas y el log: es la evidencia de que el barrido hizo algo.
   */
  @Cron(CADA_15_MINUTOS)
  async enviarRecordatorios(): Promise<number> {
    if (this.enCurso) {
      this.logger.debug('Barrido de recordatorios omitido: el anterior sigue en curso.');
      return 0;
    }

    this.enCurso = true;

    try {
      const ahora = this.tiempo.ahora();
      const limite = new Date(
        ahora.getTime() + HORAS_ANTELACION_RECORDATORIO * 60 * 60 * 1000,
      );

      // Rango amplio sobre `fecha_cita` (la columna es `DATE` y cada sede tiene
      // su zona): ayer…pasado mañana cubre cualquier cita que caiga en la
      // ventana de 2 h sin depender de la zona del proceso. El ajuste exacto se
      // hace después, con el instante real.
      const etiquetaUtcHoy = this.tiempo.fechaLocal(ahora, 'UTC');
      const candidatas = await this.prisma.reserva.findMany({
        where: {
          estado: { in: [ESTADOS.PENDIENTE, ESTADOS.CONFIRMADA] },
          recordatorioEnviado: false,
          fechaCita: {
            gte: this.tiempo.fechaDeCalendario(this.tiempo.sumarDias(etiquetaUtcHoy, -1)),
            lte: this.tiempo.fechaDeCalendario(this.tiempo.sumarDias(etiquetaUtcHoy, 2)),
          },
        },
        select: {
          id: true,
          barberiaId: true,
          clienteId: true,
          estado: true,
          fechaCita: true,
          horaInicio: true,
          cliente: {
            select: { nombreCompleto: true, correo: true, telefono: true },
          },
          barberia: {
            select: { nombre: true, telefono: true, zonaHoraria: true },
          },
        },
      });

      let enviados = 0;

      for (const reserva of candidatas) {
        try {
          const inicio = this.tiempo.aInstante(
            fechaCalendarioISO(reserva.fechaCita),
            horaRelojHHMM(reserva.horaInicio),
            reserva.barberia.zonaHoraria || ZONA_POR_DEFECTO,
          );

          const dentroDeVentana =
            inicio.getTime() > ahora.getTime() && inicio.getTime() <= limite.getTime();

          if (!dentroDeVentana) {
            continue;
          }

          // El `where` lleva el flag: si otra ejecución ya lo puso a TRUE entre
          // el `findMany` y este `updateMany`, `count` es 0 y no se avisa.
          const marcada = await this.prisma.reserva.updateMany({
            where: { id: reserva.id, recordatorioEnviado: false },
            data: { recordatorioEnviado: true },
          });

          if (marcada.count === 0) {
            continue;
          }

          const evento: EventoReserva = {
            tipo: EVENTOS_RESERVA.RECORDATORIO,
            reservaId: reserva.id,
            barberiaId: reserva.barberiaId,
            clienteId: reserva.clienteId,
            nombreCliente: reserva.cliente.nombreCompleto,
            correoCliente: reserva.cliente.correo,
            telefonoCliente: reserva.cliente.telefono,
            nombreBarberia: reserva.barberia.nombre,
            telefonoBarberia: reserva.barberia.telefono,
            fechaCita: fechaCalendarioISO(reserva.fechaCita),
            horaInicio: horaRelojHHMM(reserva.horaInicio),
            estado: reserva.estado,
            horasAntelacion: HORAS_ANTELACION_RECORDATORIO,
          };

          // `emit` (no `emitAsync`): el recordatorio es best-effort y no debe
          // alargar el barrido esperando a un proveedor externo.
          this.eventEmitter.emit(EVENTOS_RESERVA.RECORDATORIO, evento);
          enviados += 1;
        } catch (error) {
          this.logger.error(
            `No se pudo procesar el recordatorio de la reserva ${reserva.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (enviados > 0) {
        this.logger.log(`Recordatorios emitidos en este barrido: ${enviados}`);
      } else {
        this.logger.debug('Barrido de recordatorios: nada que avisar.');
      }

      return enviados;
    } catch (error) {
      // Un fallo de la consulta (base caída) no debe tumbar el proceso: el
      // siguiente tick lo vuelve a intentar, y las reservas siguen sin marcar.
      this.logger.error(
        `El barrido de recordatorios falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      this.enCurso = false;
    }
  }
}
