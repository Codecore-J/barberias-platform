import { Type } from 'class-transformer';
import { 
  IsString, 
  IsNotEmpty, 
  IsNumber, 
  IsPositive, 
  IsOptional, 
  IsBoolean, 
  Min, 
  ValidateNested, 
  IsArray, 
  IsUUID 
} from 'class-validator';

export class ComboItemDto {
  @IsUUID()
  @IsOptional()
  servicioId?: string;

  @IsUUID()
  @IsOptional()
  subComboId?: string;
}

export class CreateComboDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  precioEspecial: number;

  @IsNumber()
  @IsPositive()
  duracionPropia: number; // T3.3 Validación mayor que cero

  @IsNumber()
  @Min(0)
  @IsOptional()
  margenPropio?: number; // T3.3 Validación mayor o igual a cero

  @IsBoolean()
  @IsOptional()
  destacado?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboItemDto)
  @IsOptional()
  items?: ComboItemDto[];
}
