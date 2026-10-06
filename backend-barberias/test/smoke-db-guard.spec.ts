import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * El smoke test en vivo abre un PrismaClient contra el DATABASE_URL del proceso y
 * escribe usuarios reales (admin_smoke_*, ...). Con la URL de Neon en el entorno se
 * corrompió la base de producción. Estos tests ejecutan el script REAL como proceso
 * hijo y comprueban que la guardia lo aborta antes de tocar nada.
 */

const SCRIPT = fileURLToPath(new URL('./smoke-test-live.ts', import.meta.url));
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const BANNER = 'INICIANDO PRUEBA DE INTEGRACIÓN E2E EN VIVO';

function ejecutarSmokeTest(env: Record<string, string>): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TSX_CLI, SCRIPT],
      {
        env: { ...process.env, ...env },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        const codigo = error && typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code)
          : error
            ? 1
            : 0;
        resolve({ codigo, salida: `${stdout}${stderr}` });
      },
    );
  });
}

const URL_REMOTA = 'postgresql://usuario:clave_secreta@epizql-a1b2c3.us-east-2.aws.neon.tech:5432/barberias_prod?sslmode=require';
const URL_LOCAL = 'postgresql://postgres:barberias_local@localhost:5432/barberias_smoke_guardia';

describe('Guardia de host del smoke test en vivo', () => {
  it('aborta con 1 contra una DATABASE_URL remota, sin llegar a ejecutar el smoke test', async () => {
    const { codigo, salida } = await ejecutarSmokeTest({ APP_ENV: 'dev', DATABASE_URL: URL_REMOTA });

    expect(salida).toContain('SMOKE TEST ABORTED: DATABASE_URL points to');
    expect(salida).toContain('epizql-a1b2c3.us-east-2.aws.neon.tech:5432');
    expect(codigo).toBe(1);
    expect(salida).not.toContain(BANNER);
  }, 90_000);

  it('aborta con 1 si APP_ENV no es dev aunque la base sea local', async () => {
    const { codigo, salida } = await ejecutarSmokeTest({ APP_ENV: 'staging', DATABASE_URL: URL_LOCAL });

    expect(salida).toContain("SMOKE TEST ABORTED: APP_ENV is set to 'staging'");
    expect(codigo).toBe(1);
    expect(salida).not.toContain(BANNER);
  }, 90_000);

  it('aborta con 1 si no hay DATABASE_URL', async () => {
    const { codigo, salida } = await ejecutarSmokeTest({ APP_ENV: 'dev', DATABASE_URL: '' });

    expect(salida).toContain('SMOKE TEST ABORTED: DATABASE_URL points to');
    expect(codigo).toBe(1);
    expect(salida).not.toContain(BANNER);
  }, 90_000);

  it('deja pasar el script cuando APP_ENV es dev y la base es local', async () => {
    const { salida } = await ejecutarSmokeTest({ APP_ENV: 'dev', DATABASE_URL: URL_LOCAL });

    expect(salida).not.toContain('SMOKE TEST ABORTED');
    expect(salida).toContain(BANNER);
  }, 90_000);
});