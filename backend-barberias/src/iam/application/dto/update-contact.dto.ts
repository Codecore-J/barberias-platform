import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PhoneNotRepetitive } from '../../../shared/phone.validator.js';

/**
 * T-21 · Corrección del contacto de una cuenta «zombie».
 *
 * Los dos campos son OPCIONALES pero al menos uno debe venir: la cuenta puede
 * haber nacido con el teléfono mal tecleado, con el correo mal tecleado o con
 * los dos. Que sea el servicio —y no el DTO— quien exija «uno de los dos» es
 * deliberado: así el error sale con el contrato D40
 * (`{ statusCode, codigo, mensaje }`) y no como el array de mensajes que
 * devuelve `ValidationPipe`.
 *
 * Los formatos son EXACTAMENTE los de `RegisterDto`: si el alta exige 10
 * dígitos, la corrección no puede aceptar un formato que el alta rechazaría.
 * `telefono` es UNIQUE en la base, así que una cadena con guiones o espacios
 * sería una identidad distinta para la misma persona.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @PhoneNotRepetitive()
  @Matches(/^\d{10}$/, {
    message: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
  })
  telefono?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150, { message: 'El correo no puede superar los 150 caracteres.' })
  correo?: string;
}
