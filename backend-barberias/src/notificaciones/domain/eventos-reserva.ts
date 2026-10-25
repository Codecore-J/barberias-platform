/**
 * Fase 7 · Eventos de dominio de una reserva.
 *
 * El bus es el desacople: `ReservaService` publica lo que PASÓ (la reserva ya
 * está confirmada en la base) y `NotificacionesModule` decide cómo avisar. Ni el
 * servicio de reservas sabe que existe un proveedor de WhatsApp, ni un proveedor
 * caído puede revertir una reserva.
 *
 * Los nombres siguen el formato `<agregado>.<hecho>` para que el listener pueda
 * suscribirse con el patrón `reserva.*` en lugar de enumerar cada evento.
 */
export const EVENTOS_RESERVA = {
  /** Alta en modo MANUAL: la solicitud nace PENDIENTE. */
  CREADA: 'reserva.creada',
  /** Alta en modo AUTOMATICA, o aceptación del staff de una solicitud. */
  CONFIRMADA: 'reserva.confirmada',
  CANCELADA: 'reserva.cancelada',
  INASISTENCIA: 'reserva.inasistencia',
  /** Aviso preventivo de no-show del cron de 2 horas. */
  RECORDATORIO: 'reserva.recordatorio',
} as const;

export type TipoEventoReserva = (typeof EVENTOS_RESERVA)[keyof typeof EVENTOS_RESERVA];

/** Patrón único de suscripción: todo lo que cuelga del agregado `reserva`. */
export const PATRON_EVENTOS_RESERVA = 'reserva.*';

/** Horas de antelación del recordatorio defensivo (requisito de retención). */
export const HORAS_ANTELACION_RECORDATORIO = 2;

/**
 * Carga útil que viaja por el bus.
 *
 * Trae los datos de contacto ya resueltos —nombre, correo y teléfono del
 * cliente, nombre de la sede— para que el listener no tenga que volver a
 * consultar la base: el evento se emite después del commit y debe poder
 * entregarse aunque la fila cambie un instante después.
 *
 * `fechaCita` y `horaInicio` son ETIQUETAS locales de la sede (`YYYY-MM-DD` y
 * `HH:mm`), no instantes: el mismo criterio que la base (E2-04/D15).
 */
export interface EventoReserva {
  /** Qué ocurrió. Necesario porque el listener escucha `reserva.*`. */
  tipo: TipoEventoReserva;
  reservaId: string;
  barberiaId: string;
  clienteId: string;
  nombreCliente: string;
  correoCliente: string;
  telefonoCliente: string;
  nombreBarberia: string;
  telefonoBarberia: string;
  /** Etiqueta `YYYY-MM-DD` local a la sede. */
  fechaCita: string;
  /** Etiqueta `HH:mm` local a la sede. */
  horaInicio: string;
  /** Estado de la reserva en el momento de emitir. */
  estado: string;
  /** Solo en `reserva.recordatorio`: horas que faltan para la cita. */
  horasAntelacion?: number;
}
