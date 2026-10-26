import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

const logger = new Logger('Sentry');

/** Lee un muestreo de 0 a 1, con valor por defecto si la variable no es válida. */
function muestreo(valor: string | undefined, porDefecto: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return porDefecto;
  return Math.min(numero, 1);
}

/**
 * Observabilidad · inicialización de Sentry.
 *
 * Solo se enciende si `SENTRY_DSN` está definida: en local y en el CI el SDK no
 * se inicializa, no se abre ninguna conexión y el interceptor se convierte en un
 * no-op. Así el entorno de pruebas no depende de un servicio externo.
 *
 * El perfilado (`@sentry/profiling-node`) se carga con `import()` dinámico y
 * dentro de un `try`: es un módulo con binario nativo y, si ese binario no está
 * disponible en la plataforma, la API debe arrancar igual —con trazas pero sin
 * perfiles— en lugar de caerse al importar.
 */
export async function inicializarSentry(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  const tracesSampleRate = muestreo(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1);

  // El tipo se toma de la firma de `init` en vez de importar `Integration`
  // desde `@sentry/core`: ese paquete no es dependencia directa nuestra.
  type Integraciones = NonNullable<
    NonNullable<Parameters<typeof Sentry.init>[0]>['integrations']
  >;
  const integraciones: Integraciones = [];
  let perfilado = false;

  try {
    const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
    integraciones.push(nodeProfilingIntegration());
    perfilado = true;
  } catch (error) {
    logger.warn(
      `Perfilado de Sentry no disponible en esta plataforma; se envía solo trazas y errores: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate,
    // El perfilado se muestrea aparte y nunca por encima de las trazas: un
    // perfil sin traza asociada es un gasto de cuota sin contexto.
    ...(perfilado
      ? { profilesSampleRate: Math.min(tracesSampleRate, muestreo(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0.1)) }
      : {}),
    integrations: integraciones,
    // El backend maneja datos personales. En SDK 11 el control es granular
    // (`dataCollection`): ni IP/correo del usuario, ni cookies, ni query strings,
    // ni cabeceras (llevan el Bearer) ni cuerpos (llevan contraseñas en /login).
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
    },
    beforeSend(evento) {
      // Ni credenciales ni cuerpos: un login fallido lleva la contraseña en el
      // body y una petición autenticada lleva el Bearer en la cabecera.
      if (evento.request) {
        delete evento.request.data;
        if (evento.request.headers) {
          delete evento.request.headers.authorization;
          delete evento.request.headers.Authorization;
          delete evento.request.headers.cookie;
          delete evento.request.headers.Cookie;
        }
        if (evento.request.query_string) {
          delete evento.request.query_string;
        }
      }
      return evento;
    },
  });

  logger.log(
    `Sentry inicializado (entorno=${process.env.APP_ENV ?? 'development'}, trazas=${tracesSampleRate}, perfilado=${perfilado ? 'sí' : 'no'}).`,
  );
  return true;
}
