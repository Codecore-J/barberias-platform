import { errorDeConflicto } from '../errors/d40.errors.js';
import {
  esEstadoReserva,
  esEstadoTerminal,
  TRANSICIONES,
  type ActorTransicion,
  type EstadoReserva,
} from './estados.js';

/**
 * E2-02 · Máquina de estados de una reserva (§5.2).
 *
 * Es pura: no conoce Prisma, ni Nest, ni las colas. Solo decide dos cosas —
 * si una transición está permitida para un actor y qué efectos deja entrar en
 * el estado nuevo — y lo hace siempre con la tabla de `estados.ts`, para que no
 * exista una segunda versión del grafo repartida por los servicios.
 *
 * Los EFECTOS se declaran aquí y se ejecutan por etapas, porque tienen dos
 * dueños distintos:
 *  - `onEnter` → efectos que deben ir DENTRO de la transacción del cambio de
 *    estado (borrar la información adicional, §5.2).
 *  - `despuesDeConfirmar` → efectos que no pueden ir dentro: BullMQ no participa
 *    de la transacción de Postgres, así que cancelar un job es best-effort y se
 *    hace después de confirmar.
 *
 * El hueco de `limpiarInformacionAdicional` está declarado y cableado, pero hoy
 * es un no-op: la columna `informacion_adicional` no existe todavía (H32); llega
 * con la reserva grupal/información adicional de E4-01/E4-05.
 */

/** Efectos posibles al entrar en un estado (§5.2). */
export const EFECTOS_ENTRADA = {
  LIMPIAR_INFORMACION_ADICIONAL: 'LIMPIAR_INFORMACION_ADICIONAL',
  CANCELAR_JOBS: 'CANCELAR_JOBS',
} as const;

export type EfectoEntrada = (typeof EFECTOS_ENTRADA)[keyof typeof EFECTOS_ENTRADA];

export interface PlanDeEntrada {
  readonly enTransaccion: readonly EfectoEntrada[];
  readonly fueraDeTransaccion: readonly EfectoEntrada[];
}

/** Quién ejecuta cada efecto. Lo implementa el servicio (Prisma + BullMQ). */
export interface EjecutoresDeEfectos {
  /** Dentro de la transacción: borra la información adicional de la reserva. */
  limpiarInformacionAdicional(reservaId: string): Promise<void>;
  /** Después de confirmar: retira de BullMQ el job de expiración pendiente. */
  cancelarJobs(reservaId: string): Promise<void>;
}

export interface ContextoEntrada {
  readonly reservaId: string;
  readonly ejecutores: EjecutoresDeEfectos;
}

/**
 * Plan de efectos por estado de destino.
 *
 * - `LIMPIAR_INFORMACION_ADICIONAL` solo en los tres estados que nombra §5.2
 *   («al pasar a CANCELADA, RECHAZADA o EXPIRADA se borra de inmediato la
 *   información adicional»).
 * - `CANCELAR_JOBS` en todo estado que cierre el temporizador de los 10 minutos:
 *   cualquiera salvo PENDIENTE y PROPUESTA_PENDIENTE, que son los dos desde los
 *   que la reserva todavía puede expirar (E3-05).
 */
const PLANES_DE_ENTRADA: Readonly<Record<EstadoReserva, PlanDeEntrada>> = {
  PENDIENTE: { enTransaccion: [], fueraDeTransaccion: [] },
  CONFIRMADA: { enTransaccion: [], fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS] },
  PROPUESTA_PENDIENTE: { enTransaccion: [], fueraDeTransaccion: [] },
  RECHAZADA: {
    enTransaccion: [EFECTOS_ENTRADA.LIMPIAR_INFORMACION_ADICIONAL],
    fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS],
  },
  EXPIRADA: {
    enTransaccion: [EFECTOS_ENTRADA.LIMPIAR_INFORMACION_ADICIONAL],
    fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS],
  },
  NO_PRESENTADO: { enTransaccion: [], fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS] },
  CANCELADA: {
    enTransaccion: [EFECTOS_ENTRADA.LIMPIAR_INFORMACION_ADICIONAL],
    fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS],
  },
  COMPLETADA: { enTransaccion: [], fueraDeTransaccion: [EFECTOS_ENTRADA.CANCELAR_JOBS] },
};

export class ReservaStateMachine {
  /**
   * ¿Permite §5.2 esta transición para este actor? `desde` nulo es la creación.
   * Un estado que no pertenezca al catálogo nunca permite nada (falla cerrado).
   */
  static permite(
    desde: EstadoReserva | null,
    hacia: EstadoReserva,
    actor: ActorTransicion,
  ): boolean {
    if (desde !== null && !esEstadoReserva(desde)) {
      return false;
    }

    if (!esEstadoReserva(hacia)) {
      return false;
    }

    return TRANSICIONES.some(
      (t) => t.desde === desde && t.hacia === hacia && t.actor === actor,
    );
  }

  /**
   * E2-02 §2 · única puerta del grafo. Si la transición no está en §5.2 lanza
   * 409 `ESTADO_INVALIDO` (D40); si no se lanza, la transición es legítima.
   */
  static assertTransition(
    desde: EstadoReserva | null,
    hacia: EstadoReserva,
    actor: ActorTransicion,
  ): void {
    if (desde !== null && !esEstadoReserva(desde)) {
      throw errorDeConflicto(
        'ESTADO_INVALIDO',
        `El estado almacenado «${String(desde)}» no pertenece al catálogo de §5.1: se rechaza la transición a ${String(hacia)}.`,
      );
    }

    if (!this.permite(desde, hacia, actor)) {
      throw errorDeConflicto(
        'ESTADO_INVALIDO',
        `Transición no permitida: ${desde ?? 'creación'} → ${String(hacia)} con el actor ${actor}.`,
      );
    }
  }

  /** La matriz de §5.2 tal cual, para inspeccionarla o probarla. */
  static transiciones(): readonly (typeof TRANSICIONES)[number][] {
    return TRANSICIONES;
  }

  static esTerminal(estado: unknown): boolean {
    return esEstadoTerminal(estado);
  }

  static planesDeEntrada(): Readonly<Record<EstadoReserva, PlanDeEntrada>> {
    return PLANES_DE_ENTRADA;
  }

  static planDeEntrada(hacia: EstadoReserva): PlanDeEntrada {
    const plan = PLANES_DE_ENTRADA[hacia];

    if (!plan) {
      throw errorDeConflicto(
        'ESTADO_INVALIDO',
        `No hay plan de entrada declarado para el estado «${String(hacia)}».`,
      );
    }

    return plan;
  }

  /** Todos los efectos declarados al entrar en un estado, sin distinguir etapa. */
  static efectosDeEntrada(hacia: EstadoReserva): readonly EfectoEntrada[] {
    const plan = this.planDeEntrada(hacia);
    return [...plan.enTransaccion, ...plan.fueraDeTransaccion];
  }

  /** Efectos dentro de la transacción (§5.2: borrar la información adicional). */
  static async onEnter(hacia: EstadoReserva, contexto: ContextoEntrada): Promise<void> {
    for (const efecto of this.planDeEntrada(hacia).enTransaccion) {
      await this.ejecutar(efecto, contexto);
    }
  }

  /** Efectos posteriores a la transacción (BullMQ: cancelar jobs pendientes). */
  static async despuesDeConfirmar(
    hacia: EstadoReserva,
    contexto: ContextoEntrada,
  ): Promise<void> {
    for (const efecto of this.planDeEntrada(hacia).fueraDeTransaccion) {
      await this.ejecutar(efecto, contexto);
    }
  }

  private static async ejecutar(
    efecto: EfectoEntrada,
    { reservaId, ejecutores }: ContextoEntrada,
  ): Promise<void> {
    switch (efecto) {
      case EFECTOS_ENTRADA.LIMPIAR_INFORMACION_ADICIONAL:
        await ejecutores.limpiarInformacionAdicional(reservaId);
        return;
      case EFECTOS_ENTRADA.CANCELAR_JOBS:
        await ejecutores.cancelarJobs(reservaId);
        return;
    }
  }
}
