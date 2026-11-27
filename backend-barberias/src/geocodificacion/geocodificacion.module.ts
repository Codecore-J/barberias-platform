import { Module } from '@nestjs/common';
import { NominatimService } from './nominatim.service.js';

/**
 * F6 / T-61 · geocodificación.
 *
 * Vive aparte de `BarberiaModule` porque no es una regla de la sede: es un
 * adaptador a un proveedor externo que la sede consume. Se exporta para que el
 * alta de sede (T-62) lo inyecte sin volver a construirlo.
 */
@Module({
  providers: [NominatimService],
  exports: [NominatimService],
})
export class GeocodificacionModule {}
