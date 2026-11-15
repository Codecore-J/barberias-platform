/**
 * T-15 · Métricas del día a nivel de PLATAFORMA.
 *
 * Es el contrato del home del ADMINISTRADOR global, que no tiene sede activa y
 * por tanto no puede leer `/shops/:shopId/...`. Cinco números que caben en una
 * sola pasada por la base: no se duplica `GET /shops/overview`, que devuelve el
 * desglose por sede de un PERIODO y es lo que usa el panel de analíticas.
 *
 * Todos los contadores son números, nunca `null`: «cero citas hoy» es un dato
 * real y la pantalla tiene que poder decirlo sin confundirlo con «no cargó».
 */
export class MetricasPlataformaHoyDto {
  /** Etiqueta local `YYYY-MM-DD` del día medido: la pantalla la muestra tal cual. */
  fecha!: string;

  /** Sedes con `estado = ACTIVO` (las que operan hoy). */
  sedesActivas!: number;

  /** Citas de hoy en TODAS las sedes (`fecha_cita` = hoy, cualquier estado). */
  citasHoy!: number;

  /** Recaudado hoy según `pagos.registrado_at`, excluyendo los ANULADOS. */
  recaudadoHoy!: number;

  /** Turnos de caja ABIERTOS ahora mismo (arqueo en curso). */
  cajasAbiertas!: number;

  /** Cuentas con `estado_cuenta = ACTIVO`. */
  usuariosActivos!: number;
}
