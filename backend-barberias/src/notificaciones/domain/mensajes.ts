import { EVENTOS_RESERVA, type EventoReserva } from './eventos-reserva.js';
import { EVENTOS_LISTA_ESPERA, type EventoCupoDisponible } from './eventos-lista-espera.js';

/**
 * Fase 7 · Redacción de los avisos al cliente.
 *
 * Es una función PURA a propósito: el texto de un recordatorio es una regla de
 * negocio, no una llamada a la red. Así se prueba sin mocks y el listener queda
 * como mero transporte.
 *
 * Los mensajes no repiten datos sensibles más allá de lo que el cliente ya ve en
 * su propia reserva: ni identificadores internos, ni nombres de participantes
 * del grupo, ni motivos clínicos de un antecedente.
 */

export type CanalNotificacion = 'EMAIL' | 'WHATSAPP';

export interface MensajeNotificacion {
  asunto: string;
  cuerpo: string;
  canales: readonly CanalNotificacion[];
}

/** `2026-10-26` → `26/10/2026`; si la etiqueta viene rara, se devuelve tal cual. */
export function formatearFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  if (!anio || !mes || !dia) {
    return fecha;
  }
  return `${dia}/${mes}/${anio}`;
}

export function componerMensaje(
  evento: EventoReserva | EventoCupoDisponible,
): MensajeNotificacion {
  // Fase 9: cupo liberado en lista de espera
  if ((evento as EventoCupoDisponible).tipo === EVENTOS_LISTA_ESPERA.CUPO_DISPONIBLE) {
    const ev = evento as EventoCupoDisponible;
    const saludo = `Hola ${ev.nombreCliente || ''}`.trim();
    const cita = `${formatearFecha(ev.fecha)} de ${ev.horaInicio} a ${ev.horaFin}`;
    return {
      asunto: `¡Se liberó un turno en ${ev.nombreBarberia}!`,
      cuerpo: `${saludo ? saludo + ', ' : ''}¡Se liberó un turno en ${ev.nombreBarberia} para el ${cita}! Reserva antes de que lo tome otra persona.`,
      canales: ['EMAIL', 'WHATSAPP'],
    };
  }

  const evReserva = evento as EventoReserva;
  const cita = `${formatearFecha(evReserva.fechaCita)} a las ${evReserva.horaInicio}`;
  const saludo = `Hola ${evReserva.nombreCliente}`;

  switch (evReserva.tipo) {
    case EVENTOS_RESERVA.CREADA:
      return {
        asunto: `Solicitud de cita recibida · ${evReserva.nombreBarberia}`,
        cuerpo: `${saludo}, recibimos tu solicitud en ${evReserva.nombreBarberia} para el ${cita}. Queda pendiente de confirmación por la sede.`,
        canales: ['EMAIL'],
      };

    case EVENTOS_RESERVA.CONFIRMADA:
      return {
        asunto: `Tu cita está confirmada · ${evReserva.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita en ${evReserva.nombreBarberia} quedó confirmada para el ${cita}. Te esperamos.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };

    case EVENTOS_RESERVA.CANCELADA:
      return {
        asunto: `Cita cancelada · ${evReserva.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita del ${cita} en ${evReserva.nombreBarberia} quedó cancelada. Si quieres, puedes reservar otro horario desde la aplicación.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };

    case EVENTOS_RESERVA.INASISTENCIA:
      return {
        asunto: `No pudimos atenderte · ${evReserva.nombreBarberia}`,
        cuerpo: `${saludo}, registramos que no pudiste asistir a tu cita del ${cita} en ${evReserva.nombreBarberia}. Esta inasistencia cuenta en el límite de tu cuenta en esa sede.`,
        canales: ['EMAIL'],
      };

    case EVENTOS_RESERVA.RECORDATORIO: {
      const horas = evReserva.horasAntelacion ?? 2;
      return {
        asunto: `Recordatorio de tu cita · ${evReserva.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita en ${evReserva.nombreBarberia} es en ${horas} horas (${cita}). Si no puedes asistir, cancela desde la aplicación para liberar el horario.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };
    }

    default: {
      // `EventoReserva.tipo` es un catálogo cerrado; esta rama existe para que
      // TypeScript detecte un tipo nuevo sin mensaje y para no emitir nada raro
      // si un publicador futuro manda algo desconocido.
      const inesperado = evReserva.tipo as never;
      throw new Error(`Evento de reserva sin plantilla: ${String(inesperado)}`);
    }
  }
}
