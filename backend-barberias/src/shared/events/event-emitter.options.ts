/**
 * Opciones del bus de eventos de dominio.
 *
 * `wildcard` es obligatorio y NO es un detalle: sin él, EventEmitter2 trata
 * `reserva.*` como el nombre LITERAL de un evento, así que los listeners que se
 * suscriben con ese patrón —`AnalyticsCacheListener` (invalidación del caché de
 * analíticas) y `NotificacionesListener` (correo y WhatsApp de la reserva)— no
 * se ejecutaban nunca, aunque el productor emitiera `reserva.creada` o
 * `reserva.cancelada`. El síntoma era silencioso: el caché se quedaba con las
 * cifras de hasta 15 minutos antes y las notificaciones no salían.
 *
 * Vive en su propio módulo para que la suite pueda comprobarlo sin arrancar
 * `AppModule` (que exige base de datos y Redis).
 */
export const OPCIONES_EVENT_EMITTER = {
  wildcard: true,
} as const;
