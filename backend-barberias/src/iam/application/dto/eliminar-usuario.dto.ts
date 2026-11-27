import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * F7 / T-72 · cuerpo de `DELETE /plataforma/usuarios/:id`.
 *
 * Eliminar una cuenta es irreversible, así que la petición tiene que repetir el
 * correo EXACTO del usuario. No basta con el id de la ruta: un id copiado de la
 * pantalla equivocada borraría la cuenta equivocada y el respaldo no devuelve
 * la cuenta a la vida. La comparación estricta la hace el servicio (422
 * `CONFIRMACION_INCORRECTA`), no el `ValidationPipe`.
 */
export class EliminarUsuarioDto {
  @IsString()
  @IsNotEmpty({ message: 'La confirmación con el correo es obligatoria.' })
  @MaxLength(150, { message: 'La confirmación no puede superar los 150 caracteres.' })
  confirmacion!: string;
}
