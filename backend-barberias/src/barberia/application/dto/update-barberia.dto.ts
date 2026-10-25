import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * E3-13 · edición directa de la sede (D26/D27).
 *
 * Solo `descripcion`, `ubicacion`, `logoUrl` y `telefono` se editan directo; el
 * teléfono exige la contraseña actual (`passwordActual`, D27).
 *
 * `nombre` y `estado` se MANTIENEN en el DTO a propósito: el `ValidationPipe`
 * global usa `forbidNonWhitelisted`, así que quitarlos convertiría cualquier
 * intento de renombrar en un 400 genérico de validación. Conservándolos, el
 * servicio responde el error de negocio (422 `NOMBRE_REQUIERE_SOLICITUD` /
 * `ESTADO_NO_EDITABLE`) que dice cuál es el camino correcto.
 */
export class UpdateBarberiaDto {
  @IsString()
  @IsOptional()
  @MaxLength(150)
  nombre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descripcion?: string;

  /** Mismo formato que el alta: 10 dígitos, sin separadores. */
  @IsString()
  @IsOptional()
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  ubicacion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  logoUrl?: string;

  /** D27 · obligatoria (y correcta) si la petición cambia el teléfono. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  passwordActual?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  estado?: string;
}
