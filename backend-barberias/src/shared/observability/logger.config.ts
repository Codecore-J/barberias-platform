import { utilities as nestWinstonUtilities, type WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

/**
 * Observabilidad · formato del log de la aplicación.
 *
 * Dos transportes, un mismo logger:
 *
 * - **Producción** (`APP_ENV` o `NODE_ENV` en `production`): una línea JSON por
 *   evento, con `timestamp`, `level`, `context` y `message` como campos. Es lo
 *   que un agregador (Render, CloudWatch, Datadog) puede filtrar sin parsear
 *   texto libre.
 * - **Desarrollo**: `nestLike` con colores y `ms`, el formato al que el equipo
 *   está acostumbrado cuando corre `npm run start:dev`.
 *
 * `errors({ stack: true })` en la rama JSON conserva la traza como campo
 * `stack`; sin él, un `logger.error(..., error.stack)` llegaría como un string
 * apelotonado y se perdería la estructura.
 */
export function opcionesLogger(): WinstonModuleOptions {
  const comoJson =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

  return {
    defaultMeta: {
      servicio: 'barberias-api',
      entorno: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    },
    format: comoJson
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonUtilities.format.nestLike('Barberias', {
            colors: true,
            prettyPrint: true,
          }),
        ),
    transports: [new winston.transports.Console()],
  };
}
