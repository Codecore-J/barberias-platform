import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { EstadoConexionService } from '../services/estado-conexion.service';

/**
 * Umbral a partir del cual se avisa al usuario de que el backend está
 * despertando.
 *
 * 3,5 s es deliberado: por debajo quedan las respuestas normales (incluido el
 * peor caso de una consulta pesada o un móvil con red lenta) y por encima
 * empieza el terreno del cold start de Render, que ronda 20-50 s. Avisar antes
 * convertiría un panel lento en un panel "roto".
 */
export const UMBRAL_DESPERTAR_MS = 3500;

/**
 * Avisa a la UI cuando una petición tarda más de `UMBRAL_DESPERTAR_MS`.
 *
 * NO cancela ni reintenta: la primera petición tras el sueño tiene que poder
 * terminar (cortarla garantizaría el fallo). Solo informa, y el aviso desaparece
 * en cuanto TODAS las peticiones lentas han terminado.
 *
 * `finalize` cubre éxito, error y desuscripción: no se queda ningún contador
 * colgado aunque el componente que disparó la petición se destruya.
 */
export const coldStartInterceptor: HttpInterceptorFn = (req, next) => {
  const estado = inject(EstadoConexionService);

  let avisado = false;
  const temporizador = setTimeout(() => {
    avisado = true;
    estado.marcarDespertando();
  }, UMBRAL_DESPERTAR_MS);

  return next(req).pipe(
    finalize(() => {
      clearTimeout(temporizador);
      if (avisado) estado.marcarListo();
    }),
  );
};
