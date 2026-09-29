import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class EnviarNotificacionDto {
  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido' })
  @IsNotEmpty({ message: 'El ID del usuario destinatario es obligatorio' })
  usuarioId: string;

  @IsOptional()
  @IsString({ message: 'canal debe ser texto (EMAIL, SMS, PUSH, IN_APP)' })
  canal?: string;

  @IsString({ message: 'tipo debe ser texto' })
  @IsNotEmpty({ message: 'El tipo de notificación es obligatorio' })
  tipo: string;

  @IsString({ message: 'contenido debe ser texto' })
  @IsNotEmpty({ message: 'El contenido del mensaje es obligatorio' })
  contenido: string;
}
