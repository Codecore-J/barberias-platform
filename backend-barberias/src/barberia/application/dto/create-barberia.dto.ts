import { PhoneNotRepetitive } from '../../../shared/phone.validator.js';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNotEmpty,
  Matches,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreateBarberiaDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  nombre: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descripcion?: string;

  /** Formato local: exactamente 10 dígitos numéricos, sin separadores. */
  @IsString()
  @IsNotEmpty()
  @PhoneNotRepetitive()
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  ubicacion: string;

  /**
   * F6 / T-62 · coordenadas de la sede. OBLIGATORIAS al crear.
   *
   * Se declaran opcionales en el DTO a propósito: el contrato de la fase pide
   * **422** cuando faltan (regla de negocio), y un `class-validator` obligatorio
   * devolvería 400 desde el `ValidationPipe` antes de que el servicio pueda
   * explicar qué falta. Aquí solo se valida el TIPO y el RANGO; la presencia la
   * exige `BarberiasService.create` con `COORDENADAS_REQUERIDAS`.
   *
   * Las divisiones (provincia/municipio) NO se aceptan del cliente: las deduce
   * el backend con Nominatim para que no puedan discrepar de las coordenadas.
   */
  @IsOptional()
  @IsNumber({}, { message: 'La latitud debe ser un número decimal.' })
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @IsNumber({}, { message: 'La longitud debe ser un número decimal.' })
  @Min(-180)
  @Max(180)
  longitud?: number;
}
