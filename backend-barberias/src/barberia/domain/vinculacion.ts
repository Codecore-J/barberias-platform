/**
 * E3-12 · vocabulario y reglas de `cliente_barberias.estado_vinculacion` (D10).
 *
 * D10 fija TRES estados para la vinculación de un cliente con una sede:
 * `ACTIVO` (opera con normalidad), `PENDIENTE_APROBACION` (la 6.ª, esperando a
 * que la plataforma la resuelva) y `DESVINCULADO` (el vínculo se cerró; la fila
 * y su historial se conservan, D20/D21).
 *
 * Igual que la reserva (E2-02) y la solicitud de cambio (E3-13), el grafo vive
 * en un solo lugar: la columna es un `VARCHAR` con `CHECK`
 * (`e203_integridad_base`), así que la única barrera real del flujo es este
 * archivo.
 */

export const ESTADOS_VINCULACION = {
  ACTIVO: 'ACTIVO',
  PENDIENTE_APROBACION: 'PENDIENTE_APROBACION',
  DESVINCULADO: 'DESVINCULADO',
} as const;

export type EstadoVinculacion = (typeof ESTADOS_VINCULACION)[keyof typeof ESTADOS_VINCULACION];

export const ESTADOS_VINCULACION_LISTA: readonly EstadoVinculacion[] =
  Object.values(ESTADOS_VINCULACION);

/**
 * D10 · a partir de la SEXTA vinculación el vínculo nace `PENDIENTE_APROBACION`.
 *
 * El conteo es por USUARIO, no por sede: el límite es una decisión de
 * plataforma (una persona no acumula barberías sin control), y por eso quien
 * resuelve la solicitud es el ADMINISTRADOR global y no la sede interesada.
 * `barberia.service.ts` (vincularCliente) y este flujo comparten la constante.
 */
export const LIMITE_VINCULACIONES = 5;

/** El rechazo exige un motivo con contenido, no una palabra suelta. */
export const MOTIVO_RECHAZO_VINCULACION_MIN = 10;

/** Solo una vinculación que ESPERA se puede resolver; el resto son terminales. */
export function esVinculacionResoluble(estado: unknown): boolean {
  return estado === ESTADOS_VINCULACION.PENDIENTE_APROBACION;
}

/** Aprobar deja el vínculo `ACTIVO`; rechazar lo deja `DESVINCULADO`. */
export function estadoDeResolucion(aprobar: boolean): EstadoVinculacion {
  return aprobar ? ESTADOS_VINCULACION.ACTIVO : ESTADOS_VINCULACION.DESVINCULADO;
}
