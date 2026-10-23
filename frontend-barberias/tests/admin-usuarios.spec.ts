import { expect, test, type Page } from '@playwright/test';

/**
 * Integración visual de `/admin/usuarios` en un navegador real.
 *
 * Cubre el camino completo que pidió QA: login con una cuenta ADMINISTRADOR,
 * navegación desde el menú lateral, renderizado de KPIs y tabla, alta de una
 * cuenta desde el modal, suspensión con motivo y consulta del historial de
 * auditoría de esa misma cuenta.
 *
 * El backend se prepara fuera de Playwright: este spec solo necesita la API
 * local (Postgres + Redis de `docker-compose.yml`) y un ADMINISTRADOR sembrado:
 *
 *   cd backend-barberias
 *   set -a && . ./.env.test && set +a
 *   ADMIN_EMAIL=admin.playwright@barberias.test \
 *   ADMIN_PASSWORD='PlaywrightAdmin1!' \
 *   ADMIN_PHONE=8095550101 npm run admin:create
 *
 * Cada corrida genera su propio correo y teléfono para no chocar con datos de
 * corridas anteriores ni con las suites E2E del backend.
 *
 * Variables de entorno:
 *  - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (defaults abajo, alineados con el
 *    comandos `admin:create` documentado para el entorno local).
 *  - E2E_BASE_URL (lo lee `playwright.config.ts`).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin.playwright@barberias.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'PlaywrightAdmin1!';

const MOTIVO = 'Prueba visual de Playwright';

/** Espera a que el login haya salido de `/auth/login` (redirección por rol). */
async function esperarRedireccionDeLogin(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), {
    timeout: 30_000,
  });
}

test.describe('/admin/usuarios · gestión de cuentas de la plataforma', () => {
  test('login, KPIs, alta, suspensión auditada e historial', async ({ page }) => {
    const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const nombre = `QA Playwright ${sufijo}`;
    const correo = `qa.playwright.${sufijo}@playwright.test`;
    // `usuarios.telefono` es UNIQUE: se deriva del sufijo, no un valor fijo.
    const telefono = `809${sufijo.slice(-7)}`;
    const password = 'Playwright1!';

    await test.step('1 · Login como ADMINISTRADOR y redirección al panel', async () => {
      await page.goto('/auth/login');
      await expect(page.getByRole('heading', { name: /IMPERIAL BARBERS/i })).toBeVisible();

      await page.locator('#correo').fill(ADMIN_EMAIL);
      await page.locator('#password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Iniciar Sesión' }).click();

      await esperarRedireccionDeLogin(page);
      // El layout con el menú lateral solo se pinta con la sesión hidratada.
      // Se localiza por `href`: el icono de PrimeIcons forma parte del nombre
      // accesible del enlace ("<glifo> Usuarios"), así que un nombre exacto no
      // lo encontraría.
      const enlaceUsuarios = page.locator('a[href="/admin/usuarios"]:visible').first();
      await expect(enlaceUsuarios).toBeVisible();
    });

    await test.step('2 · Navegación por el menú lateral, KPIs y tabla', async () => {
      await page.locator('a[href="/admin/usuarios"]:visible').first().click();

      await expect(page).toHaveURL(/\/admin\/usuarios$/);
      await expect(page.getByRole('heading', { name: /Gestión de Usuarios/ })).toBeVisible();

      await expect(page.getByText('Total de usuarios', { exact: true })).toBeVisible();
      await expect(page.getByText('Cuentas activas', { exact: true })).toBeVisible();
      await expect(page.getByText('Cuentas suspendidas', { exact: true })).toBeVisible();

      // La tabla siempre trae al menos la cuenta con la que se entró; si la
      // bandeja estuviera vacía el componente pinta su estado vacío explícito.
      const filas = page.locator('tbody tr');
      await expect(filas.first()).toBeVisible();
      await expect(page.getByText(ADMIN_EMAIL, { exact: true })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
    });

    await test.step('3 · Alta de una cuenta CLIENTE desde el modal', async () => {
      await page.getByRole('button', { name: 'Nuevo Usuario' }).click();

      const dialogo = page.getByRole('dialog');
      await expect(dialogo.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible();

      await dialogo.locator('input[name="formNombre"]').fill(nombre);
      await dialogo.locator('input[name="formCorreo"]').fill(correo);
      await dialogo.locator('input[name="formTelefono"]').fill(telefono);
      await dialogo.locator('input[name="formPassword"]').fill(password);
      await dialogo.locator('select[name="formRol"]').selectOption({ label: 'CLIENTE' });

      await dialogo.getByRole('button', { name: 'Crear usuario' }).click();

      await expect(dialogo).toBeHidden();
      await expect(page.getByText(`Cuenta creada: ${nombre}`, { exact: false })).toBeVisible();

      // La lista se reordena por fecha de registro: la cuenta nueva aparece.
      const filaCreada = page.locator('tbody tr').filter({ hasText: correo });
      await expect(filaCreada).toBeVisible();
      await expect(filaCreada.getByText('CLIENTE', { exact: true })).toBeVisible();
      await expect(filaCreada.getByText('ACTIVO', { exact: true })).toBeVisible();
    });

    await test.step('4 · Suspensión de la cuenta con motivo y auditoría', async () => {
      const fila = page.locator('tbody tr').filter({ hasText: correo });

      await fila.getByRole('button', { name: 'Cambiar Estado' }).click();

      const dialogo = page.getByRole('dialog');
      await expect(
        dialogo.getByRole('heading', { name: `Cambiar estado de ${nombre}` }),
      ).toBeVisible();

      await dialogo.locator('textarea[name="motivo"]').fill(MOTIVO);
      await dialogo.getByRole('button', { name: 'Confirmar' }).click();

      await expect(dialogo).toBeHidden();
      await expect(page.getByText(`Cuenta suspendida: ${nombre}`, { exact: false })).toBeVisible();
      await expect(fila.getByText('SUSPENDIDO', { exact: true })).toBeVisible();

      await fila.getByRole('button', { name: 'Historial' }).click();

      const historial = page.getByRole('dialog');
      await expect(historial.getByRole('heading', { name: 'Historial de la cuenta' })).toBeVisible();

      // El evento de la suspensión recién hecha, con su motivo y su autor.
      const evento = historial.locator('li').filter({ hasText: 'Cuenta suspendida' });
      await expect(evento).toBeVisible();
      await expect(evento.getByText(MOTIVO, { exact: false })).toBeVisible();
      await expect(evento.getByText('Sesiones cerradas', { exact: true })).toBeVisible();
      await expect(evento.getByText(ADMIN_EMAIL, { exact: false })).toBeVisible();

      // El alta de la cuenta también quedó registrada, más abajo.
      await expect(historial.getByText('Cuenta creada', { exact: true })).toBeVisible();

      await historial.getByRole('button', { name: 'Cerrar' }).click();
      await expect(historial).toBeHidden();
    });
  });
});
