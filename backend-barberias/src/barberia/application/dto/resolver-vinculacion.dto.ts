import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** E3-12 · decisión sobre una 6ª vinculación (§1.2, D10). */
export const DECISIONES_VINCULACION = ['APROBAR', 'RECHAZAR'] as const;
export type DecisionVinculacion = (typeof DECISIONES_VINCULACION)[number];

/**
 * E3-12 · resolución de una vinculación `PENDIENTE_APROBACION`.
 *
 * El `motivo` es obligatorio al RECHAZAR —sin él el cliente no sabe qué hacer—
 * y opcional al APROBAR. En la práctica cada endpoint usa su propia variante
 * (`AprobarVinculacionDto` / `RechazarVinculacionDto`), pero comparten esta
 * base para que la validación no se duplique.
 */
export class ResolverVinculacionDto {
  @IsIn(DECISIONES_VINCULACION)
  decision: DecisionVinculacion;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres.' })
  @MaxLength(300)
  motivo?: string;
}

/** Aprobar: el motivo es opcional (queda en la auditoría si llega). */
export class AprobarVinculacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/** Rechazar: el motivo es obligatorio (§5.5). */
export class RechazarVinculacionDto {
  @IsString()
  @IsNotEmpty({ message: 'El motivo del rechazo es obligatorio.' })
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres.' })
  @MaxLength(300)
  motivo: string;
}
