import { Inject, Injectable, Optional } from '@nestjs/common';
import { DateTime } from 'luxon';

/**
 * E2-04 / D15 · Reloj y zona horaria de la barbería (hallazgo H36).
 *
 * El modelo separa dos cosas que antes se confundían:
 *
 *  - **Etiquetas de calendario** (`reservas.fecha_cita` es `DATE`, `hora_inicio`
 *    y `hora_fin` son `TIME`, igual que `horarios` y `bloqueos_agenda`): NO
 *    llevan zona. Dicen «2026-10-10» y «21:00» tal como los ve la sede.
 *  - **Instantes** (`expira_at`, `creado_at`, `PropuestaHorario.expira_at`): son
 *    UTC y se comparan contra el reloj real.
 *
 * Componer una etiqueta con la zona del SERVIDOR —lo que hacía
 * `new Date(fecha); setHours(...)`— es el bug de H36: Render corre en UTC, una
 * sede en `America/Santo_Domingo` está en UTC-4 y una cita a las 21:00 locales
 * (01:00 UTC del día siguiente) quedaba anclada 4 horas después de lo real, así
 * que la ventana de cancelación de §5.7 cerraba ~4 h tarde. Igual de grave era
 * `fecha.getDay()`: con el servidor al oeste de UTC devolvía el día anterior y
 * la disponibilidad se calculaba contra el horario del día equivocado.
 *
 * Todo servicio que necesite cruzar etiqueta ↔ instante pasa por aquí. La zona
 * sale de `barberias.zona_horaria`.
 */

/** Token del reloj inyectable. En pruebas se sustituye por un reloj fijo. */
export const RELOJ = Symbol('RELOJ');

/** Reloj: función pura que devuelve el instante actual. */
export type Reloj = () => Date;

export interface PartesLocales {
  /** Fecha local de la sede en formato `YYYY-MM-DD`. */
  fecha: string;
  /** Hora local de la sede en formato `HH:mm`. */
  hora: string;
}

/** Zona del catálogo cuando la sede no la trae (columna con DEFAULT en la BD). */
export const ZONA_POR_DEFECTO = 'America/Santo_Domingo';

/**
 * Día de la semana ISO de una fecha de calendario: 1 = lunes … 7 = domingo.
 * Es el valor que espera `horarios.dia_semana`. Acepta la fecha como etiqueta
 * `YYYY-MM-DD` (o un `Date` cuya parte UTC se toma como etiqueta).
 */
export function diaSemanaISODesdeFecha(fecha: Date): number {
  // La etiqueta de un DATE que devuelve Prisma está en la medianoche UTC, así
  // que sus partes UTC SON el día etiquetado, sin importar la zona del servidor.
  return DateTime.utc(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth() + 1,
    fecha.getUTCDate(),
  ).weekday;
}

/**
 * Etiqueta `YYYY-MM-DD` de una fecha de calendario. Lee las partes UTC, que es
 * donde Prisma deja un `DATE`: `toISOString().slice(0, 10)` daba el mismo
 * resultado solo por casualidad y el backlog prohíbe esa construcción.
 */
export function fechaCalendarioISO(fecha: Date): string {
  const y = String(fecha.getUTCFullYear()).padStart(4, '0');
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const d = String(fecha.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Etiqueta `HH:mm` de una hora de reloj. Un `TIME` llega de Prisma como
 * `1970-01-01T00:00Z` con la hora tecleada en UTC; se leen sus partes UTC.
 */
export function horaRelojHHMM(hora: Date): string {
  const h = String(hora.getUTCHours()).padStart(2, '0');
  const m = String(hora.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

@Injectable()
export class TiempoService {
  constructor(
    @Optional()
    @Inject(RELOJ)
    private readonly reloj: Reloj = () => new Date(),
  ) {}

  /** Instante actual. Único punto de lectura del reloj real. */
  ahora(): Date {
    return this.reloj();
  }

  /**
   * Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha de calendario
   * `YYYY-MM-DD` en la zona de la sede. Es el valor de `horarios.dia_semana`.
   */
  diaSemana(fechaIso: string, tz: string = ZONA_POR_DEFECTO): number {
    const dt = DateTime.fromISO(fechaIso, { zone: tz });
    if (!dt.isValid) {
      throw new Error(`Fecha ISO inválida: ${fechaIso}`);
    }
    return dt.weekday;
  }

  /**
   * Compone el instante UTC real de una fecha y hora LOCALES de la sede.
   * `aInstante('2026-10-10', '21:00', 'America/Santo_Domingo')` →
   * `2026-10-11T01:00:00.000Z`.
   */
  aInstante(fecha: string, hora: string, tz: string = ZONA_POR_DEFECTO): Date {
    const dt = DateTime.fromISO(`${fecha}T${hora}`, { zone: tz });
    if (!dt.isValid) {
      throw new Error(`Fecha/hora inválida para ${tz}: ${fecha} ${hora}`);
    }
    return dt.toJSDate();
  }

  /**
   * Descompone un instante en fecha y hora LOCALES de la sede.
   * `desdeInstante('2026-10-11T01:00:00Z', 'America/Santo_Domingo')` →
   * `{ fecha: '2026-10-10', hora: '21:00' }`.
   */
  desdeInstante(instante: Date, tz: string = ZONA_POR_DEFECTO): PartesLocales {
    const dt = DateTime.fromJSDate(instante, { zone: tz });
    return { fecha: dt.toFormat('yyyy-MM-dd'), hora: dt.toFormat('HH:mm') };
  }

  /** Fecha local `YYYY-MM-DD` de un instante en la zona de la sede. */
  fechaLocal(instante: Date, tz: string = ZONA_POR_DEFECTO): string {
    return this.desdeInstante(instante, tz).fecha;
  }

  /** Suma (o resta) días de calendario a una fecha `YYYY-MM-DD`. */
  sumarDias(fechaIso: string, dias: number): string {
    return DateTime.fromISO(fechaIso, { zone: 'utc' }).plus({ days: dias }).toFormat('yyyy-MM-dd');
  }

  /**
   * `Date` que representa una etiqueta de calendario `YYYY-MM-DD`: la medianoche
   * UTC del día, que es exactamente cómo Prisma devuelve y escribe una columna
   * `DATE`. Centraliza la construcción para no depender de `new Date(str)`.
   */
  fechaDeCalendario(fechaIso: string): Date {
    return DateTime.fromISO(fechaIso.slice(0, 10), { zone: 'utc' }).toJSDate();
  }
}
