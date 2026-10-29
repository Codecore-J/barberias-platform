import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** `HH:mm` de 24 horas: lo mismo que acepta un `<input type="time">`. */
const HORA_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * V3 fase 5 · un día de la semana del horario propio del barbero.
 *
 * `diaSemana` es ISO (1 = lunes … 7 = domingo), la convención que ya usan
 * `TiempoService.diaSemana` y la tabla `horarios` de la sede. El 0 = domingo no
 * se acepta: cambiar la numeración obligaría a reescribir el motor entero.
 *
 * Un día libre no lleva horas. La DTO las deja opcionales para que el cuerpo sea
 * legible y es el servicio quien exige la combinación correcta con mensajes en
 * español (400), porque esa regla necesita comparar horas, no solo campos.
 */
export class DiaHorarioBarberoDto {
  @IsInt({ message: 'diaSemana debe ser un número entero.' })
  @Min(1, { message: 'diaSemana va de 1 (lunes) a 7 (domingo).' })
  @Max(7, { message: 'diaSemana va de 1 (lunes) a 7 (domingo).' })
  diaSemana: number;

  @IsBoolean({ message: 'esDiaLibre debe ser booleano.' })
  esDiaLibre: boolean;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaInicio debe tener formato HH:mm.' })
  horaInicio?: string | null;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaFin debe tener formato HH:mm.' })
  horaFin?: string | null;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaInicioDescanso debe tener formato HH:mm.' })
  horaInicioDescanso?: string | null;

  @IsOptional()
  @Matches(HORA_HHMM, { message: 'horaFinDescanso debe tener formato HH:mm.' })
  horaFinDescanso?: string | null;
}
