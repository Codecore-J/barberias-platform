import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  THROTTLER_LIMITE_POR_DEFECTO,
  THROTTLER_TTL_MS,
} from '../src/app.module.js';
import { AuthController } from '../src/iam/infrastructure/auth.controller.js';
import { AnalyticsController } from '../src/analytics/infrastructure/analytics.controller.js';
import { NotificacionesWebhookController } from '../src/notificaciones/infrastructure/notificaciones-webhook.controller.js';
import { HealthController } from '../src/health/health.controller.js';

/**
 * Rate limiting (SEC-02) · Paso 16.
 *
 * Verifica la política sobre los metadatos que `@Throttle` / `@SkipThrottle`
 * depositan en los manejadores: es la misma información que lee
 * `ThrottlerGuard` en cada petición, sin tener que arrancar `AppModule`
 * (eso exige base de datos y Redis).
 */
// Acceso por descriptor: `@Throttle` deposita los metadatos en la función del
// manejador, y referenciarlo como `Clase.prototype.metodo` dispara el linter
// (unbound-method) sin aportar nada aquí.
const manejador = (
  clase: abstract new (...args: never[]) => unknown,
  nombre: string,
): ((...args: never[]) => unknown) | undefined =>
  Object.getOwnPropertyDescriptor(clase.prototype, nombre)?.value;

const limiteDe = (metodo?: (...args: never[]) => unknown): number | undefined =>
  metodo ? Reflect.getMetadata('THROTTLER:LIMITdefault', metodo) : undefined;
const ttlDe = (metodo?: (...args: never[]) => unknown): number | undefined =>
  metodo ? Reflect.getMetadata('THROTTLER:TTLdefault', metodo) : undefined;

describe('Rate limiting (SEC-02) · configuración', () => {
  it('define una ventana por defecto de 120 peticiones por minuto', () => {
    expect(THROTTLER_TTL_MS).toBe(60000);
    expect(THROTTLER_LIMITE_POR_DEFECTO).toBe(120);

    // El literal del módulo debe coincidir con las constantes exportadas.
    const fuente = readFileSync(join(process.cwd(), 'src', 'app.module.ts'), 'utf8');
    expect(fuente).toMatch(/ttl: THROTTLER_TTL_MS/);
    expect(fuente).toMatch(/limit: THROTTLER_LIMITE_POR_DEFECTO/);
    expect(fuente).toMatch(/provide: APP_GUARD,\s*\n\s*useClass: ThrottlerGuard/);
  });

  it('limita el login y el registro a 5 intentos por minuto (fuerza bruta)', () => {
    expect(limiteDe(manejador(AuthController, 'login'))).toBe(5);
    expect(ttlDe(manejador(AuthController, 'login'))).toBe(60000);
    expect(limiteDe(manejador(AuthController, 'register'))).toBe(5);
  });

  it('limita la exportación CSV de analíticas a 10 por minuto (DoS de BD)', () => {
    expect(limiteDe(manejador(AnalyticsController, 'exportCsv'))).toBe(10);
    expect(ttlDe(manejador(AnalyticsController, 'exportCsv'))).toBe(60000);
  });

  it('permite 50 webhook de WhatsApp por segundo (ráfagas del proveedor)', () => {
    expect(limiteDe(manejador(NotificacionesWebhookController, 'recibir'))).toBe(50);
    expect(ttlDe(manejador(NotificacionesWebhookController, 'recibir'))).toBe(1000);
  });

  it('las sondas de salud quedan fuera del rate limit', () => {
    const salteado = (nombre: string): unknown => {
      const metodo = manejador(HealthController, nombre);
      return metodo ? Reflect.getMetadata('THROTTLER:SKIPdefault', metodo) : undefined;
    };

    expect(salteado('liveness')).toBe(true);
    expect(salteado('check')).toBe(true);
  });
});