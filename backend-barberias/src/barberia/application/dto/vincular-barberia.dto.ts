import { IsNotEmpty, IsString } from 'class-validator';

export class VincularBarberiaDto {
  @IsString()
  @IsNotEmpty()
  codigoAcceso: string;
}
