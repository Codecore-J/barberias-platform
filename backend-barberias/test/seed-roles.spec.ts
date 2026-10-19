import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E0-07 · una base limpia nace con los CUATRO roles del sistema.
 *
 * El seed es el único camino que deja una instalación recién migrada en
 * condiciones de operar, y `BarberiaService.create` exige `ADMIN_BARBERIA` para
 * dejar operativo al responsable. Si alguien recorta el array de roles, esta
 * prueba falla antes de que el alta de sedes descubra el hueco en producción.
 *
 * Se inspecciona el BLOQUE `const roles = [...]`, no el archivo entero: los
 * nombres también aparecen en `findUniqueOrThrow` y en los permisos, y una
 * mención suelta no prueba que el rol se cree.
 */
const SEED = readFileSync(join(process.cwd(), 'prisma', 'seed.ts'), 'utf8');

function bloqueDeRoles(): string {
  const match = /const roles = \[([\s\S]*?)\n\s*\];/.exec(SEED);
  if (!match) {
    throw new Error('no se encontró el bloque `const roles = [...]` en prisma/seed.ts');
  }
  return match[1];
}

describe('E0-07 · roles del seed', () => {
  it('crea CLIENTE, ADMIN_BARBERIA, BARBERO y ADMINISTRADOR', () => {
    const nombres = [...bloqueDeRoles().matchAll(/nombre:\s*'([^']+)'/g)].map((m) => m[1]);

    expect(nombres.sort()).toEqual(
      ['ADMINISTRADOR', 'ADMIN_BARBERIA', 'BARBERO', 'CLIENTE'].sort(),
    );
  });

  it('asigna permisos a ADMIN_BARBERIA (no lo deja como rol vacío)', () => {
    expect(SEED).toMatch(/const rolAdminBarberia = await prisma\.rol\.findUniqueOrThrow/);
    expect(SEED).toMatch(/asignarPermisos\(rolAdminBarberia\.id, permisosAdminBarberia\)/);
  });
});
