/**
 * E4-02 · D47 — un SOLO cálculo de huecos.
 *
 * Los dos carriles de esta tarea —las alternativas cuando una reserva no cabe
 * y la exposición de espacios remanentes— beben de esta misma función pura, que
 * a su vez es el algoritmo de proyección de E3-02. No hay un segundo algoritmo
 * de huecos en el código: `DisponibilidadService` proyecta con
 * `proyectarTramosLibres` y las alternativas se eligen con `elegirAlternativas`
 * sobre LOS MISMOS tramos proyectados.
 *
 * D37/H41: aquí solo se CALCULA, nunca se retiene. Un hueco sugerido no es un
 * hueco reservado; quien lo ocupe primero se lo queda y el que recibió la
 * sugerencia recibe un 409 honesto al confirmar.
 *
 * Todo es PURO: entradas y salidas son `Date` (instantes), no hay Prisma, ni
 * Nest, ni reloj propio. El llamador compone la jornada, lee las ocupaciones y
 * traduce la respuesta a etiquetas.
 */

/** D41 · paso de búsqueda de los horarios ofrecidos al cliente. */
export const PASO_MINUTOS = 15;

/**
 * Paso histórico de `calcularDisponibilidad` (E3-02). Se conserva para no
 * cambiar el comportamiento del endpoint de disponibilidad.
 */
export const PASO_DISPONIBILIDAD_MINUTOS = 30;

/** §E4-02/2 · máximo de alternativas que se ofrecen en una respuesta. */
export const MAXIMO_ALTERNATIVAS = 5;

export interface Intervalo {
  inicio: Date;
  fin: Date;
}

/** Una alternativa ofrecida al cliente: un tramo donde el bloque CABE entero. */
export interface Alternativa {
  inicio: Date;
  fin: Date;
}

/**
 * Une intervalos solapados o contiguos. Es el mismo criterio que usaba
 * `DisponibilidadService`: dos ocupaciones que se tocan son UNA sola.
 */
export function fusionarIntervalos(intervalos: readonly Intervalo[]): Intervalo[] {
  if (intervalos.length === 0) return [];

  const ordenados = [...intervalos].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const fusionados: Intervalo[] = [{ ...ordenados[0] }];

  for (let i = 1; i < ordenados.length; i++) {
    const ultimo = fusionados[fusionados.length - 1];
    const actual = ordenados[i];
    if (actual.inicio.getTime() <= ultimo.fin.getTime()) {
      if (actual.fin.getTime() > ultimo.fin.getTime()) {
        ultimo.fin = new Date(actual.fin.getTime());
      }
    } else {
      fusionados.push({ ...actual });
    }
  }

  return fusionados;
}

/** Hay solapamiento si los dos intervalos comparten al menos un instante. */
export function estaSolapado(intento: Intervalo, ocupados: readonly Intervalo[]): boolean {
  for (const ocupado of ocupados) {
    if (intento.inicio.getTime() < ocupado.fin.getTime() && intento.fin.getTime() > ocupado.inicio.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * E3-02/E4-02 · proyecta los tramos en los que cabe un bloque COMPLETO
 * (margen incluido) dentro de una jornada, sin pisar ninguna ocupación.
 *
 * La proyección empieza en el inicio de la jornada y avanza de `pasoMinutos`
 * en `pasoMinutos` (D41). No devuelve huecos del pasado: eso es cosa de quien
 * llama, que conoce «ahora».
 */
export function proyectarTramosLibres(
  jornada: Intervalo,
  ocupados: readonly Intervalo[],
  duracionRequeridaMinutos: number,
  pasoMinutos: number = PASO_DISPONIBILIDAD_MINUTOS,
): Intervalo[] {
  const duracion = duracionRequeridaMinutos * 60000;
  const paso = Math.max(1, Math.floor(pasoMinutos)) * 60000;

  if (!(duracion > 0)) return [];
  if (jornada.inicio.getTime() >= jornada.fin.getTime()) return [];

  const fusionados = fusionarIntervalos(ocupados);
  const libres: Intervalo[] = [];

  let cursor = jornada.inicio.getTime();
  const finJornada = jornada.fin.getTime();

  while (cursor + duracion <= finJornada) {
    const tramo: Intervalo = { inicio: new Date(cursor), fin: new Date(cursor + duracion) };
    if (!estaSolapado(tramo, fusionados)) {
      libres.push(tramo);
    }
    cursor += paso;
  }

  return libres;
}

export interface SolicitudDeAlternativas {
  jornada: Intervalo;
  ocupados: readonly Intervalo[];
  /** Duración del bloque completo: servicios + margen. */
  duracionRequeridaMinutos: number;
  /** «Ahora»: nada de lo que ya pasó se ofrece. */
  ahora: Date;
  /** Paso de búsqueda (D41). Por defecto 15. */
  pasoMinutos?: number;
  /** Máximo de alternativas (§E4-02/2). Por defecto 5. */
  maximo?: number;
  /**
   * Hora pedida. Las alternativas se ordenan por cercanía a ella y se elige el
   * inicio más próximo de cada tramo libre; sin ella se ordena por cercanía a
   * «ahora», que es la lectura proactiva (huecos de última hora).
   */
  horaObjetivo?: Date;
}

/**
 * Elige, entre los tramos proyectados, las alternativas a ofrecer:
 *  - descarta lo que ya pasó,
 *  - ordena por cercanía a `horaObjetivo` (o a «ahora»),
 *  - no ofrece dos sugerencias que se solapen entre sí (una vez sugerido un
 *    tramo, el siguiente candidato debe ser un hueco distinto),
 *  - acota a `maximo`.
 *
 * Cada alternativa es un tramo REAL: el bloque cabe entero y no choca con nada.
 * Ninguna de ellas retiene nada (D37/H41).
 */
export function elegirAlternativas(solicitud: SolicitudDeAlternativas): Alternativa[] {
  const pasoMinutos = solicitud.pasoMinutos ?? PASO_MINUTOS;
  const maximo = solicitud.maximo ?? MAXIMO_ALTERNATIVAS;

  if (maximo <= 0) return [];

  const candidatos = proyectarTramosLibres(
    solicitud.jornada,
    solicitud.ocupados,
    solicitud.duracionRequeridaMinutos,
    pasoMinutos,
  );

  const ahoraMs = solicitud.ahora.getTime();
  const objetivoMs = (solicitud.horaObjetivo ?? solicitud.ahora).getTime();

  const ordenados = candidatos
    .filter((c) => c.inicio.getTime() >= ahoraMs)
    .sort((a, b) => {
      const distancia = Math.abs(a.inicio.getTime() - objetivoMs) - Math.abs(b.inicio.getTime() - objetivoMs);
      // A igual distancia, el más temprano gana: es determinista.
      return distancia !== 0 ? distancia : a.inicio.getTime() - b.inicio.getTime();
    });

  const elegidos: Alternativa[] = [];
  for (const candidato of ordenados) {
    if (elegidos.length >= maximo) break;
    if (estaSolapado(candidato, elegidos)) continue;
    elegidos.push(candidato);
  }

  return elegidos;
}
