/**
 * E4-01 · Reserva grupal (D45/D46, `docs/BACKLOG_BARBERIAS_V1.md` §5.3 y §5.4).
 *
 * Una reserva grupal es UN adulto responsable —la cuenta del CLIENTE— más uno o
 * más niños, y el bloque es la suma de las duraciones de TODOS los participantes
 * más UN SOLO margen de la sede (D42). Es la misma regla que ya usa el flujo
 * individual: el margen se aplica al final del bloque, nunca por persona.
 *
 * Todo lo de este archivo es PURO: no conoce Prisma, ni Nest, ni las colas. La
 * duración y el precio que devuelve `calcularBloqueGrupal` son los mismos que
 * usan `crearReserva` y `cotizar` (D44: el frontend nunca calcula el bloque) y
 * los mismos que alimentan la disponibilidad, que recibe ya resueltos
 * `duracionTotal` y `margenRequerido`.
 *
 * D45 · «espacio» es una plaza de participante DENTRO de una reserva grupal,
 * nunca un carril paralelo: la agenda conserva un único carril por sede (D06),
 * así que dos reservas de la misma sede siguen sin poder solaparse aunque sus
 * grupos sumen menos que `max_personas_total`.
 */

/**
 * D46 · tope DURO de plataforma. Ni una sede con límites nulos puede superarlo:
 * un límite nulo significa «sin límite propio de la sede», nunca «sin
 * validación». Es una constante del sistema, no configuración del tenant.
 */
export const MAX_PARTICIPANTES_POR_GRUPO = 8;

/** Servicio ya resuelto contra el catálogo ACTIVO de ESA sede. */
export interface ServicioDelGrupo {
  duracionEstimada: number;
  precio: number;
}

/** Participante con sus servicios ya resueltos (para el bloque y el snapshot). */
export interface ParticipanteDelGrupo {
  nombre: string;
  esAdultoResponsable: boolean;
  servicios: readonly ServicioDelGrupo[];
}

/** Participante tal como llega en el DTO: solo ids de servicio (aún sin resolver). */
export interface ParticipanteParaValidar {
  nombre?: string;
  esAdultoResponsable: boolean;
  servicios: readonly string[];
}

/** Límites efectivos de la sede (E3-11). `null` = sin límite propio de la sede. */
export interface LimitesDeGrupo {
  maxPersonasTotal: number | null;
  maxNinos: number | null;
}

/** Bloque calculado de una reserva grupal (§5.4). */
export interface BloqueGrupal {
  /** Σ de las duraciones de los servicios de TODOS los participantes. */
  duracionServicios: number;
  /** El ÚNICO margen de la sede, aplicado una vez al final del bloque (D42). */
  margenGrupal: number;
  /** Duración total ocupada en la agenda: `duracionServicios + margenGrupal`. */
  duracionTotal: number;
  /** Σ de los precios del catálogo de todos los participantes (§5.4). */
  precioTotal: number;
}

/** Conteo de participantes: el adulto responsable CUENTA como persona (§D46). */
export interface ConteoDeGrupo {
  personas: number;
  ninos: number;
  adultos: number;
}

/**
 * Problema de negocio detectado en el grupo. Se devuelve como dato (no se lanza)
 * para que el dominio siga siendo puro y el servicio decida el HTTP/código.
 */
export type ProblemaDeGrupo =
  | { tipo: 'GRUPO_INCOMPLETO' }
  | { tipo: 'ADULTOS'; adultos: number }
  | { tipo: 'PARTICIPANTE_SIN_SERVICIOS'; indice: number }
  | { tipo: 'PARTICIPANTE_SIN_NOMBRE'; indice: number }
  | {
      tipo: 'CAPACIDAD';
      campo: 'MAX_PARTICIPANTES_POR_GRUPO' | 'maxPersonasTotal' | 'maxNinos';
      limite: number;
      solicitado: number;
    };

/**
 * Cuenta personas y niños del grupo (D46). `personas = participantes.length`
 * —el adulto cuenta— y `ninos = personas - 1`, porque el resto son niños (§5.4).
 */
export function contarParticipantes(
  participantes: readonly { esAdultoResponsable: boolean }[],
): ConteoDeGrupo {
  const personas = participantes.length;
  return {
    personas,
    ninos: Math.max(0, personas - 1),
    adultos: participantes.filter((p) => p.esAdultoResponsable === true).length,
  };
}

/**
 * Calcula el bloque grupal: Σ duraciones + UN margen (D42). El margen se suma
 * UNA sola vez al final, nunca por participante ni por servicio.
 */
export function calcularBloqueGrupal(
  participantes: readonly ParticipanteDelGrupo[],
  margenGrupalMinutos: number,
): BloqueGrupal {
  let duracionServicios = 0;
  let precioTotal = 0;

  for (const participante of participantes) {
    for (const servicio of participante.servicios) {
      duracionServicios += servicio.duracionEstimada;
      precioTotal += servicio.precio;
    }
  }

  const margenGrupal = margenGrupalMinutos ?? 0;
  return {
    duracionServicios,
    margenGrupal,
    duracionTotal: duracionServicios + margenGrupal,
    precioTotal,
  };
}

/**
 * Valida la ESTRUCTURA del grupo y su CAPACIDAD (D46), en ese orden y en una
 * sola pasada pura. El servicio la invoca ANTES del lock `FOR UPDATE`, porque
 * un rechazo por capacidad no necesita serializar la sede entera y además debe
 * tener precedencia sobre `CONFLICTO_HORARIO` (§E4-01 punto 7).
 *
 * Circular además con `CAPACIDAD_EXCEDIDA` cuando corresponda y devolver `null`
 * si el grupo es válido.
 */
export function validarGrupoGrupal(
  participantes: readonly ParticipanteParaValidar[],
  limites: LimitesDeGrupo,
): ProblemaDeGrupo | null {
  // §E4-01/2: la reserva grupal es un adulto responsable + uno o más niños.
  if (participantes.length < 2) {
    return { tipo: 'GRUPO_INCOMPLETO' };
  }

  const { personas, ninos, adultos } = contarParticipantes(participantes);

  if (adultos !== 1) {
    return { tipo: 'ADULTOS', adultos };
  }

  for (const [indice, participante] of participantes.entries()) {
    if (typeof participante.nombre !== 'string' || participante.nombre.trim().length === 0) {
      return { tipo: 'PARTICIPANTE_SIN_NOMBRE', indice };
    }
    if (!participante.servicios || participante.servicios.length === 0) {
      return { tipo: 'PARTICIPANTE_SIN_SERVICIOS', indice };
    }
  }

  // D46 · el tope de plataforma manda sobre cualquier configuración de la sede.
  if (personas > MAX_PARTICIPANTES_POR_GRUPO) {
    return {
      tipo: 'CAPACIDAD',
      campo: 'MAX_PARTICIPANTES_POR_GRUPO',
      limite: MAX_PARTICIPANTES_POR_GRUPO,
      solicitado: personas,
    };
  }

  if (limites.maxPersonasTotal != null && personas > limites.maxPersonasTotal) {
    return {
      tipo: 'CAPACIDAD',
      campo: 'maxPersonasTotal',
      limite: limites.maxPersonasTotal,
      solicitado: personas,
    };
  }

  if (limites.maxNinos != null && ninos > limites.maxNinos) {
    return {
      tipo: 'CAPACIDAD',
      campo: 'maxNinos',
      limite: limites.maxNinos,
      solicitado: ninos,
    };
  }

  return null;
}

/** Mensaje en español del problema, listo para el contrato de errores (D40). */
export function mensajeDeProblema(problema: ProblemaDeGrupo): string {
  switch (problema.tipo) {
    case 'GRUPO_INCOMPLETO':
      return 'Una reserva grupal requiere un adulto responsable y al menos un niño.';
    case 'ADULTOS':
      return `Una reserva grupal requiere exactamente un adulto responsable (llegaron ${problema.adultos}).`;
    case 'PARTICIPANTE_SIN_NOMBRE':
      return `El participante ${problema.indice + 1} necesita un nombre.`;
    case 'PARTICIPANTE_SIN_SERVICIOS':
      return `El participante ${problema.indice + 1} debe tener al menos un servicio.`;
    case 'CAPACIDAD': {
      if (problema.campo === 'maxNinos') {
        return `El grupo supera el máximo de niños de la sede (${problema.solicitado} > ${problema.limite}).`;
      }
      if (problema.campo === 'maxPersonasTotal') {
        return `El grupo supera el máximo de personas de la sede (${problema.solicitado} > ${problema.limite}).`;
      }
      return `El grupo supera el máximo de participantes por grupo (${problema.solicitado} > ${problema.limite}).`;
    }
  }
}
