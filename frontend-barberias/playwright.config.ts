import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de interfaz del frontend (navegador real).
 *
 * Las pruebas viven en `tests/` y hablan con la app Angular de desarrollo, que
 * llama a su vez al backend local en `http://localhost:3000/api/v1`. Playwright
 * levanta el dev server por su cuenta salvo que ya haya uno escuchando
 * (`reuseExistingServer`), y ese dev server NO arranca el backend: para la
 * pantalla de usuarios hace falta la API con Postgres y Redis arriba.
 *
 * Variables:
 *  - E2E_BASE_URL         URL del frontend (default http://localhost:4200).
 *  - E2E_ADMIN_EMAIL      correo del ADMINISTRADOR de prueba.
 *  - E2E_ADMIN_PASSWORD   contraseña de ese administrador.
 *  - E2E_SKIP_WEB_SERVER  si vale "1", no intenta levantar `ng serve`.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4200';

/**
 * `ng serve` prioriza la variable `PORT` sobre `--port`; algunos entornos la
 * dejan en `0` (puerto aleatorio). El dev server de Playwright la fija en 4200
 * para que la URL de `baseURL` sea la real.
 */
const serverEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, valor]) => valor !== undefined),
) as Record<string, string>;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // Un solo flujo con estado compartido (alta → suspensión → historial): sin
  // paralelismo entre archivos para no competir por la misma bandeja global.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // El menú lateral de escritorio se oculta por debajo de `lg`; un
        // viewport amplio garantiza que el enlace "Usuarios" sea el visible.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer:
    process.env.E2E_SKIP_WEB_SERVER === '1'
      ? undefined
      : {
          command: 'npm start -- --port 4200',
          env: { ...serverEnv, PORT: '4200' },
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
});
