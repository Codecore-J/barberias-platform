import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiciosService } from '../src/catalogo/application/servicios.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { vi } from 'vitest';

/**
 * T-22 · descripción del servicio en el catálogo que ya gestiona el
 * ADMIN_BARBERIA (`servicios`), no en un catálogo nuevo.
 *
 * Lo que fija esta prueba:
 *  1. El modelo `Servicio` declara `descripcion` opcional con tope de 500.
 *  2. Existe la migración que añade la columna, sin recrear la tabla.
 *  3. El servicio de aplicación la guarda al crear y al editar, recortando
 *     espacios y convirtiendo el vacío en NULL (no en cadena vacía).
 */
const RAIZ = process.cwd();
const ESQUEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8');
const MIGRACIONES = join(RAIZ, 'prisma/migrations');

function modeloServicio(): string {
  const bloque = ESQUEMA.match(/model Servicio \{[\s\S]*?\n\}/);
  return bloque?.[0] ?? '';
}

function sqlDeDescripcion(): string {
  const carpeta = readdirSync(MIGRACIONES).find((nombre) => nombre.includes('descripcion_servicio'));
  if (!carpeta) return '';
  const ruta = join(MIGRACIONES, carpeta, 'migration.sql');
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
}

describe('T-22 · descripción del servicio', () => {
  const SEDE = '11111111-1111-4111-8111-111111111111';
  const SERVICIO = '44444444-4444-4444-8444-444444444444';

  describe('modelo y migración', () => {
    it('`Servicio.descripcion` es opcional y admite hasta 500 caracteres', () => {
      const modelo = modeloServicio();
      expect(modelo).not.toBe('');
      expect(modelo).toMatch(/descripcion\s+String\?\s+@db\.VarChar\(500\)/);
    });

    it('existe la migración y AÑADE la columna sin recrear `servicios`', () => {
      const sql = sqlDeDescripcion();
      expect(sql).not.toBe('');
      expect(sql).toMatch(/ALTER TABLE\s+"?servicios"?\s+ADD COLUMN\s+(IF NOT EXISTS\s+)?"descripcion"/i);
      expect(sql).toMatch(/VARCHAR\(500\)/i);
      expect(sql).not.toMatch(/DROP TABLE/i);
    });
  });

  describe('ServiciosService', () => {
    const prisma = {
      servicio: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      reserva: { findMany: vi.fn() },
      combo: { findMany: vi.fn() },
    };

    const service = new ServiciosService(prisma as unknown as PrismaService);

    it('guarda la descripción recortada al crear', async () => {
      prisma.servicio.create.mockResolvedValue({ id: SERVICIO });

      await service.create(SEDE, {
        nombre: 'Corte',
        precio: 20,
        descripcion: '  Tijera y máquina  ',
      } as never);

      expect(prisma.servicio.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ descripcion: 'Tijera y máquina' }),
        }),
      );
    });

    it('crea con descripción NULL si no se envía o viene vacía', async () => {
      prisma.servicio.create.mockResolvedValue({ id: SERVICIO });

      await service.create(SEDE, { nombre: 'Corte', precio: 20 } as never);
      await service.create(SEDE, { nombre: 'Corte', precio: 20, descripcion: '   ' } as never);

      for (const llamada of prisma.servicio.create.mock.calls) {
        expect(llamada[0].data.descripcion).toBeNull();
      }
    });

    it('guarda la descripción al editar y permite vaciarla', async () => {
      prisma.servicio.findFirst.mockResolvedValue({ id: SERVICIO, barberiaId: SEDE });
      prisma.servicio.update.mockResolvedValue({ id: SERVICIO });

      await service.update(SEDE, SERVICIO, { descripcion: '  Nuevo texto ' } as never);
      await service.update(SEDE, SERVICIO, { descripcion: '   ' } as never);

      expect(prisma.servicio.update).toHaveBeenNthCalledWith(1, {
        where: { id: SERVICIO },
        data: { descripcion: 'Nuevo texto' },
      });
      expect(prisma.servicio.update).toHaveBeenNthCalledWith(2, {
        where: { id: SERVICIO },
        data: { descripcion: null },
      });
    });
  });
});
