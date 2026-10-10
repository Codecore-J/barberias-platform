/**
 * E2-02 · Catálogo de estados de una reserva y matriz de transiciones.
 *
 * FUENTE ÚNICA (D08 y D14, BACKLOG §5.1 y §5.2). Todo el backend escribe y
 * compara estados a través de estas constantes: no debe quedar ningún literal
 * de estado de reserva en el resto del código, porque hoy `reservas.estado` es
 * un `VARCHAR` sin `CHECK` (E2-03) y la única barrera es esta tabla.
 *
 * §5.1 (D08, 8 valores): `PENDIENTE`, `CONFIRMADA`, `RECHAZADA`,
 * `PROPUESTA_PENDIENTE`, `EXPIRADA`, `NO_PRESENTADO`, `CANCELADA`, `COMPLETADA`.
 * Los cinco últimos (menos PROPUESTA_PENDIENTE y PENDIENTE) son terminales.
 *
 * Deuda registrada: el sistema escribió `NO_ASISTIO` hasta E2-02, un noveno
 * valor que nunca estuvo en §5.1; `src/cliente/` (módulo contenido, H22) sigue
 * mencionándolo junto a `CANCELADA_TARDE`. Ver H45.
 */

export const ESTADOS = {
  PENDIENTE: 'PENDIENTE',
  CONFIRMADA: 'CONFIRMADA',
  RECHAZADA: 'RECHAZADA',
  PROPUESTA_PENDIENTE: 'PROPUESTA_PENDIENTE',
  EXPIRADA: 'EXPIRADA',
  NO_PRESENTADO: 'NO_PRESENTADO',
  CANCELADA: 'CANCELADA',
  COMPLETADA: 'COMPLETADA',
} as const;

export type EstadoReserva = (typeof ESTADOS)[keyof typeof ESTADOS];

/** Los 8 estados en el orden de §5.1, para recorrerlos (tests, validaciones). */
export const ESTADOS_RESERVA: readonly EstadoReserva[] = Object.values(ESTADOS);

/** §5.1 · estados sin salida: la reserva terminó y ya no ocupa agenda (§5.3). */
export const ESTADOS_TERMINALES = [
  ESTADOS.RECHAZADA,
  ESTADOS.EXPIRADA,
  ESTADOS.NO_PRESENTADO,
  ESTADOS.CANCELADA,
  ESTADOS.COMPLETADA,
] as const;

export type EstadoTerminal = (typeof ESTADOS_TERMINALES)[number];

/**
 * D18 §5.4 · estados de una `propuesta_horario`.
 *
 * NO son los de la reserva aunque compartan tres nombres: una propuesta no es
 * una reserva, y por eso viven en su propio catálogo en vez de reutilizar
 * `ESTADOS`. Vivían como literales sueltos en `reserva.service.ts` hasta E2-02.
 */
export const ESTADOS_PROPUESTA = {
  PENDIENTE: 'PENDIENTE',
  ACEPTADA: 'ACEPTADA',
  RECHAZADA: 'RECHAZADA',
  EXPIRADA: 'EXPIRADA',
} as const;

export type EstadoPropuesta = (typeof ESTADOS_PROPUESTA)[keyof typeof ESTADOS_PROPUESTA];

/** D18 · las tres clases de propuesta del §5.4. */
export const TIPOS_PROPUESTA = {
  PROPUESTA_INICIAL: 'PROPUESTA_INICIAL',
  REPROGRAMACION: 'REPROGRAMACION',
  ADELANTO: 'ADELANTO',
} as const;

export type TipoPropuesta = (typeof TIPOS_PROPUESTA)[keyof typeof TIPOS_PROPUESTA];

/** D17 · estados de `reservas.cancelacion_especial_estado` (solicitud de la sede). */
export const ESTADOS_CANCELACION_ESPECIAL = {
  SOLICITADA: 'SOLICITADA',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
} as const;

export type EstadoCancelacionEspecial =
  (typeof ESTADOS_CANCELACION_ESPECIAL)[keyof typeof ESTADOS_CANCELACION_ESPECIAL];

/** §5.2 · actores de una transición: C = cliente dueño, A = sede, S = sistema. */
export const ACTORES = {
  CLIENTE: 'CLIENTE',
  STAFF: 'STAFF',
  SISTEMA: 'SISTEMA',
} as const;

export type ActorTransicion = (typeof ACTORES)[keyof typeof ACTORES];

export interface TransicionPermitida {
  /** `null` = la CREACIÓN de la reserva (§5.2, filas 1 y 2). */
  readonly desde: EstadoReserva | null;
  readonly hacia: EstadoReserva;
  readonly actor: ActorTransicion;
  /** Condición de negocio de §5.2; el grafo no la evalúa (vive en cada flujo). */
  readonly condicion: string;
}

/**
 * §5.2 · la matriz, fila por fila. `CONFIRMADA → CANCELADA` aparece dos veces
 * a propósito: la cliente puede cancelar hasta 30 minutos antes y la sede puede
 * cancelar con motivo obligatorio; la lectura de la tabla es un OR por actor.
 */
export const TRANSICIONES: readonly TransicionPermitida[] = [
  {
    desde: null,
    hacia: ESTADOS.PENDIENTE,
    actor: ACTORES.CLIENTE,
    condicion: 'creación en modo MANUAL: expira_at = ahora + 10 min',
  },
  {
    desde: null,
    hacia: ESTADOS.CONFIRMADA,
    actor: ACTORES.CLIENTE,
    condicion: 'creación en modo AUTOMATICO: sin temporizador',
  },
  {
    desde: ESTADOS.PENDIENTE,
    hacia: ESTADOS.CONFIRMADA,
    actor: ACTORES.STAFF,
    condicion: 'temporizador vigente y disponibilidad revalidada',
  },
  {
    desde: ESTADOS.PENDIENTE,
    hacia: ESTADOS.RECHAZADA,
    actor: ACTORES.STAFF,
    condicion: 'motivo estructurado obligatorio',
  },
  {
    desde: ESTADOS.PENDIENTE,
    hacia: ESTADOS.PROPUESTA_PENDIENTE,
    actor: ACTORES.STAFF,
    condicion: 'nuevo horario disponible; 10 min para el cliente',
  },
  {
    desde: ESTADOS.PENDIENTE,
    hacia: ESTADOS.EXPIRADA,
    actor: ACTORES.SISTEMA,
    condicion: 'pasaron 10 min sin respuesta',
  },
  {
    desde: ESTADOS.PENDIENTE,
    hacia: ESTADOS.CANCELADA,
    actor: ACTORES.CLIENTE,
    condicion: 'la clienta retira su solicitud en cualquier momento',
  },
  {
    desde: ESTADOS.PROPUESTA_PENDIENTE,
    hacia: ESTADOS.CONFIRMADA,
    actor: ACTORES.CLIENTE,
    condicion: 'acepta la propuesta, revalidada',
  },
  {
    desde: ESTADOS.PROPUESTA_PENDIENTE,
    hacia: ESTADOS.CANCELADA,
    actor: ACTORES.CLIENTE,
    condicion: 'rechaza la propuesta (D08)',
  },
  {
    desde: ESTADOS.PROPUESTA_PENDIENTE,
    hacia: ESTADOS.EXPIRADA,
    actor: ACTORES.SISTEMA,
    condicion: 'pasaron 10 min',
  },
  {
    desde: ESTADOS.CONFIRMADA,
    hacia: ESTADOS.COMPLETADA,
    actor: ACTORES.STAFF,
    condicion: 'desde hora_inicio, al registrar la atención',
  },
  {
    desde: ESTADOS.CONFIRMADA,
    hacia: ESTADOS.NO_PRESENTADO,
    actor: ACTORES.STAFF,
    condicion: 'ahora >= inicio + 15 min (5 de margen + 10 de tolerancia)',
  },
  {
    desde: ESTADOS.CONFIRMADA,
    hacia: ESTADOS.CANCELADA,
    actor: ACTORES.CLIENTE,
    condicion: 'hasta 30 min antes del inicio',
  },
  {
    desde: ESTADOS.CONFIRMADA,
    hacia: ESTADOS.CANCELADA,
    actor: ACTORES.STAFF,
    condicion: 'motivo obligatorio o cancelación especial aprobada (D17)',
  },
];

/** Comprueba en tiempo de ejecución que un valor es uno de los 8 estados. */
export function esEstadoReserva(valor: unknown): valor is EstadoReserva {
  return typeof valor === 'string' && (ESTADOS_RESERVA as readonly string[]).includes(valor);
}

/** Los que no son terminales: una reserva viva sigue ocupando agenda (§5.3). */
export function esEstadoTerminal(estado: unknown): estado is EstadoTerminal {
  return (ESTADOS_TERMINALES as readonly string[]).includes(estado as string);
}
