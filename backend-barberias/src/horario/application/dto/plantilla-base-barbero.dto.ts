import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** `HH:mm` de 24 horas: lo mismo que acepta un `<input type="time">`. */
const HORA_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * V3 · un bloque de la PLANTILLA semanal del barbero.
 *
 * `diaSemana` es ISO (1 = lunes … 7 = domingo), la misma numeración que
 * `HorarioBarbero` y `TiempoService.diaSemana`: la plantilla se materializa en
 * el horario de cada sede sin conversiones.
 *
 * `activo` en falso conserva el bloque pero lo deja fuera de la semana (el
 * barbero lo apaga sin perder las horas, para volver a encenderlo luego). Si un
 * día llega apagado y sin horas, el servicio solo lo apaga si ya existía: un
 * bloque que nunca existió no se crea vacío.
 */
export class DiaPlantillaBarberoDto {
  @IsInt({ message: 'diaSemana debe ser un número entero.' })
  @Min(1, { message: 'diaSemana va de 1 (lunes) a 7 (domingo).' })
  @Max(7, { message: 'diaSemana va de 1 (lunes) a 7 (domingo).' })
  diaSemana: number;

  @IsOptional()
  @IsBoolean({ message: 'activo debe ser booleano.' })
  activo?: boolean;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaInicio debe tener formato HH:mm.' })
  horaInicio?: string | null;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaFin debe tener formato HH:mm.' })
  horaFin?: string | null;
}

/**
 * V3 · `PUT /shops/:shopId/mi-horario/base`.
 *
 * Es upsert MASIVO, no un reemplazo: el barbero manda solo los días que cambia
 * y el resto queda como está. Se aceptan hasta siete filas y nunca dos del
 * mismo día (el servicio responde 400 y la base tiene su propio UNIQUE).
 */
export class GuardarPlantillaBaseDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Debes enviar al menos un día.' })
  @ArrayMaxSize(7, { message: 'La semana tiene siete días como máximo.' })
  @ValidateNested({ each: true })
  @Type(() => DiaPlantillaBarberoDto)
  dias: DiaPlantillaBarberoDto[];
}

/** Un día de la plantilla tal y como lo devuelve la API. */
export interface DiaPlantillaBarberoResponse {
  /** ISO: 1 = lunes … 7 = domingo. */
  diaSemana: number;
  /** `null` cuando el barbero nunca configuró ese día. */
  horaInicio: string | null;
  horaFin: string | null;
  /**
   * Solo tiene sentido con horas: un día sin bloque (`horaInicio` nulo) es
   * siempre `false`, porque no hay nada que activar.
   */
  activo: boolean;
}

export interface PlantillaBaseBarberoResponse {
  barberoId: string;
  /**
   * `true` cuando el barbero todavía no guardó ninguna plantilla. La pantalla lo
   * usa para explicar que sus sedes siguen con el horario de la sede.
   */
  sinPlantilla: boolean;
  /** Los siete días, con los no configurados en `null`. */
  dias: DiaPlantillaBarberoResponse[];
}
