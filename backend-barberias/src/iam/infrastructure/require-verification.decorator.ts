import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFICATION_KEY = 'requirePhoneVerification';

/**
 * V2.1 · Marca una ruta como «solo con el teléfono verificado».
 *
 * El decorador pone la intención en la firma de la ruta y el `VerificacionGuard`
 * la hace cumplir; sin él, el guard no exige nada y la ruta queda abierta. La
 * comprobación es una bandera del USUARIO, no del rol, así que convive con
 * `@Roles(...)`: primero pasa el rol, después la verificación.
 *
 * Ejemplo:
 * `@RequireVerification() @UseGuards(VerificacionGuard)`
 */
export const RequireVerification = () => SetMetadata(REQUIRE_VERIFICATION_KEY, true);
