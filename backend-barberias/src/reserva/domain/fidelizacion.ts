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
 * §5.8 · los 5 minutos de puntualidad más los 10 de tolerancia. Pasado ese
 * margen la cita se considera no presentada; ANTES de él, marcarla es un error
 * de la sede (H52) y se responde 422 `FUERA_DE_VENTANA`.
 *
 * Viven aquí, con la regla, y no enterrados en el servicio: el no presentado de
 * E3-10 y su ventana son la misma regla de §5.8 (D47 en su espíritu).
 */
export const PUNTUALIDAD_MARGEN_MIN = 5;
export const TOLERANCIA_MIN = 10;
export const VENTANA_NO_PRESENTADO_MIN = PUNTUALIDAD_MARGEN_MIN + TOLERANCIA_MIN;

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

/**
 * E4-03/2 (H54) · lo que el CLIENTE ve de su propia fidelización.
 *
 * Es la vista pública de la MISMA regla: no decide nada nuevo, traduce el
 * contador de la sede a un mensaje que el cliente puede leer. Por eso vive aquí
 * y no en el servicio: la regla se escribe una vez (D47) y el endpoint solo la
 * proyecta.
 */
export interface EstadoVisibleFidelizacion {
  contadorNoPresentado: number;
  estaRestringido: boolean;
  motivoRestriccion: string | null;
  /** `true` con 3 o más inasistencias: el perfil muestra la advertencia. */
  advertencia: boolean;
  /** Inasistencias que faltan para que ESTA sede restrinja (0 si ya lo está). */
  inasistenciasParaRestriccion: number;
  /** Texto listo para mostrar. `null` cuando no hay nada que avisar. */
  mensaje: string | null;
}

/**
 * Proyecta el estado de UNA vinculación al lenguaje del cliente.
 *
 * Tres casos, sin ambigüedad:
 *  - restringido: el motivo que guardó la restricción (o un texto neutro si por
 *    lo que fuera llegara vacío);
 *  - con 3 o más inasistencias: cuántas faltan para el bloqueo de la sede;
 *  - por debajo del umbral: sin mensaje. Antes del aviso no se asusta a nadie.
 */
export function describirEstadoFidelizacion(
  estado: EstadoFidelizacion & { contadorNoPresentado: number },
  limiteDeLaSede: number = LIMITE_INASISTENCIAS_POR_DEFECTO,
): EstadoVisibleFidelizacion {
  const inasistenciasParaRestriccion = Math.max(0, limiteDeLaSede - estado.contadorNoPresentado);
  const advertencia =
    estado.estaRestringido || estado.contadorNoPresentado >= UMBRAL_ADVERTENCIA_INASISTENCIAS;

  if (estado.estaRestringido) {
    return {
      contadorNoPresentado: estado.contadorNoPresentado,
      estaRestringido: true,
      motivoRestriccion: estado.motivoRestriccion,
      advertencia: true,
      inasistenciasParaRestriccion: 0,
      mensaje:
        estado.motivoRestriccion ?? 'Estás restringido para reservar en esta barbería.',
    };
  }

  return {
    contadorNoPresentado: estado.contadorNoPresentado,
    estaRestringido: false,
    motivoRestriccion: null,
    advertencia,
    inasistenciasParaRestriccion,
    mensaje: advertencia
      ? inasistenciasParaRestriccion === 0
        ? 'Alcanzaste el límite de inasistencias de esta barbería.'
        : `Estás a ${inasistenciasParaRestriccion} inasistencia${
            inasistenciasParaRestriccion === 1 ? '' : 's'
          } de ser suspendido en esta barbería.`
      : null,
  };
}
