import { EVENTOS_RESERVA, type EventoReserva } from './eventos-reserva.js';

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

export function componerMensaje(evento: EventoReserva): MensajeNotificacion {
  const cita = `${formatearFecha(evento.fechaCita)} a las ${evento.horaInicio}`;
  const saludo = `Hola ${evento.nombreCliente}`;

  switch (evento.tipo) {
    case EVENTOS_RESERVA.CREADA:
      return {
        asunto: `Solicitud de cita recibida · ${evento.nombreBarberia}`,
        cuerpo: `${saludo}, recibimos tu solicitud en ${evento.nombreBarberia} para el ${cita}. Queda pendiente de confirmación por la sede.`,
        canales: ['EMAIL'],
      };

    case EVENTOS_RESERVA.CONFIRMADA:
      return {
        asunto: `Tu cita está confirmada · ${evento.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita en ${evento.nombreBarberia} quedó confirmada para el ${cita}. Te esperamos.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };

    case EVENTOS_RESERVA.CANCELADA:
      return {
        asunto: `Cita cancelada · ${evento.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita del ${cita} en ${evento.nombreBarberia} quedó cancelada. Si quieres, puedes reservar otro horario desde la aplicación.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };

    case EVENTOS_RESERVA.INASISTENCIA:
      return {
        asunto: `No pudimos atenderte · ${evento.nombreBarberia}`,
        cuerpo: `${saludo}, registramos que no pudiste asistir a tu cita del ${cita} en ${evento.nombreBarberia}. Esta inasistencia cuenta en el límite de tu cuenta en esa sede.`,
        canales: ['EMAIL'],
      };

    case EVENTOS_RESERVA.RECORDATORIO: {
      const horas = evento.horasAntelacion ?? 2;
      return {
        asunto: `Recordatorio de tu cita · ${evento.nombreBarberia}`,
        cuerpo: `${saludo}, tu cita en ${evento.nombreBarberia} es en ${horas} horas (${cita}). Si no puedes asistir, cancela desde la aplicación para liberar el horario.`,
        canales: ['EMAIL', 'WHATSAPP'],
      };
    }

    default: {
      // `EventoReserva.tipo` es un catálogo cerrado; esta rama existe para que
      // TypeScript detecte un tipo nuevo sin mensaje y para no emitir nada raro
      // si un publicador futuro manda algo desconocido.
      const inesperado: never = evento.tipo;
      throw new Error(`Evento de reserva sin plantilla: ${String(inesperado)}`);
    }
  }
}
