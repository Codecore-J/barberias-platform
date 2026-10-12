/**
 * E3-10 / E4-03 · Fidelización por inasistencias (spec 01 §5.8, plan T5.4, D48).
 *
 * Reglas del negocio:
 *  - 3 inasistencias acumuladas en una sede → advertencia visible en el perfil.
 *  - 5 inasistencias en ESA sede → `esta_restringido = true` con su motivo.
 *  - D48: la penalización es LOCAL. Este módulo solo decide el estado de UNA
 *    fila de `cliente_barberias`; jamás toca `usuarios.estado_cuenta`, porque
 *    suspender la cuenta global es una decisión manual del ADMINISTRADOR de la
 *    plataforma (D09/D24) y no una consecuencia del contador de una sede.
 *
 * El cálculo vive aquí, puro y sin Prisma, para que la regla sea una sola: la
 * usa `ReservaService.marcarInasistencia` y la cubre su propio spec.
 */

/** Inasistencias a partir de las cuales el perfil muestra advertencia. */
export const UMBRAL_ADVERTENCIA_INASISTENCIAS = 3;

/**
 * Límite por defecto de la sede (spec 01 §5.8: «5 → restricción impuesta por
 * esa barbería, nunca global»).
 *
 * Es un parámetro de `evaluarInasistencia` y no un literal enterrado en el
 * servicio: si una sede necesitara otro umbral, la firma ya lo admite y la
 * regla sigue siendo una sola (D47 en su espíritu: un único calculador).
 */
export const LIMITE_INASISTENCIAS_POR_DEFECTO = 5;

export interface EstadoFidelizacion {
  estaRestringido: boolean;
  motivoRestriccion: string | null;
}

export interface EvaluacionInasistencia {
  /** Contador ya incrementado (el que se persiste en la fila de la sede). */
  contadorNoPresentado: number;
  estaRestringido: boolean;
  motivoRestriccion: string | null;
  /** `true` con 3 o más: el perfil del cliente muestra la advertencia. */
  advertencia: boolean;
  /** `true` solo en la inasistencia que cruza el límite de la sede. */
  restringidoAhora: boolean;
}

/**
 * Calcula el estado de la vinculación tras UNA nueva inasistencia.
 *
 * No reinicia nada: una restricción vigente se conserva con su motivo aunque
 * el contador siga subiendo (D20), y el motivo solo se escribe cuando la
 * restricción nace en este mismo movimiento.
 */
export function evaluarInasistencia(
  contadorActual: number,
  estadoActual: EstadoFidelizacion,
  limiteDeLaSede: number = LIMITE_INASISTENCIAS_POR_DEFECTO,
): EvaluacionInasistencia {
  const contadorNoPresentado = contadorActual + 1;
  const restringidoAhora = !estadoActual.estaRestringido && contadorNoPresentado >= limiteDeLaSede;

  return {
    contadorNoPresentado,
    estaRestringido: estadoActual.estaRestringido || restringidoAhora,
    motivoRestriccion: restringidoAhora
      ? `Bloqueo automático: alcanzaste el límite de ${limiteDeLaSede} inasistencias en esta barbería.`
      : estadoActual.motivoRestriccion,
    advertencia: contadorNoPresentado >= UMBRAL_ADVERTENCIA_INASISTENCIAS,
    restringidoAhora,
  };
}
