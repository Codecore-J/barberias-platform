import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CategoriasService } from '../src/catalogo/application/categorias.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';

/**
 * T-21 · CRUD del ADMINISTRADOR global sobre las categorías globales.
 *
 * Crear y editar ya existen desde T-20; lo que fija esta prueba es el BORRADO:
 *  - una categoría global sin servicios se elimina de verdad;
 *  - una categoría con servicios NO se borra: 409 `CATEGORIA_CON_SERVICIOS` con
 *    la cuenta en el cuerpo (`servicios`), para que el panel pueda decir cuántos
 *    la bloquean;
 *  - la cuenta incluye los servicios INACTIVOS: un servicio desactivado sigue
 *    apuntando a la categoría y borrarla lo dejaría huérfano, así que la regla
 *    no pregunta por `activo`;
 *  - la categoría de otra sede o inexistente responde 404, nunca 409.
 */
const RAIZ = process.cwd();
const CONTROLADOR = readFileSync(
  join(RAIZ, 'src/catalogo/infrastructure/categorias.controller.ts'),
  'utf8',
);

describe('T-21 · CRUD de categorías globales', () => {
  const SEDE = '11111111-1111-4111-8111-111111111111';
  const CATEGORIA = '33333333-3333-4333-8333-333333333333';

  const prisma = {
    categoriaServicio: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    servicioBarbero: {
      count: vi.fn(),
    },
  };

  let service: CategoriasService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CategoriasService(prisma as unknown as PrismaService);
  });

  function global(extra: Record<string, unknown> = {}) {
    return {
      id: CATEGORIA,
      barberiaId: null,
      nombre: 'Cortes Premium',
      descripcion: null,
      activa: true,
      orden: 3,
      servicios: [],
      ...extra,
    };
  }

  describe('eliminar', () => {
    it('elimina una categoría global que no tiene ningún servicio', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(global());
      prisma.servicioBarbero.count.mockResolvedValue(0);
      prisma.categoriaServicio.delete.mockResolvedValue(global());

      const resultado = await service.eliminar(SEDE, CATEGORIA);

      expect(prisma.categoriaServicio.delete).toHaveBeenCalledWith({
        where: { id: CATEGORIA },
      });
      expect(resultado).toMatchObject({ id: CATEGORIA, nombre: 'Cortes Premium' });
    });

    it('responde 409 CATEGORIA_CON_SERVICIOS con la cuenta y no borra nada', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(global());
      prisma.servicioBarbero.count.mockResolvedValue(2);

      await expect(service.eliminar(SEDE, CATEGORIA)).rejects.toMatchObject({
        status: 409,
        response: {
          statusCode: 409,
          codigo: 'CATEGORIA_CON_SERVICIOS',
          servicios: 2,
        },
      });
      expect(prisma.categoriaServicio.delete).not.toHaveBeenCalled();
    });

    it('cuenta también los servicios inactivos: la regla no filtra por `activo`', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(global());
      prisma.servicioBarbero.count.mockResolvedValue(1);

      await expect(service.eliminar(SEDE, CATEGORIA)).rejects.toMatchObject({
        response: { codigo: 'CATEGORIA_CON_SERVICIOS' },
      });

      expect(prisma.servicioBarbero.count).toHaveBeenCalledWith({
        where: { categoriaId: CATEGORIA },
      });
    });

    it('el mensaje del 409 dice cuántos servicios la usan', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(global());
      prisma.servicioBarbero.count.mockResolvedValue(3);

      const error = await service.eliminar(SEDE, CATEGORIA).catch((e) => e);

      expect(JSON.stringify(error.response)).toContain('3');
    });

    it('404 si la categoría no existe o no es global (nunca 409)', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);

      await expect(service.eliminar(SEDE, CATEGORIA)).rejects.toMatchObject({
        status: 404,
      });
      expect(prisma.servicioBarbero.count).not.toHaveBeenCalled();
      expect(prisma.categoriaServicio.delete).not.toHaveBeenCalled();
    });

    it('busca la categoría acotada a las globales (barberiaId nulo)', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(global());
      prisma.servicioBarbero.count.mockResolvedValue(0);
      prisma.categoriaServicio.delete.mockResolvedValue(global());

      await service.eliminar(SEDE, CATEGORIA);

      expect(prisma.categoriaServicio.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: CATEGORIA, barberiaId: null }),
        }),
      );
    });
  });

  describe('ruta HTTP', () => {
    it('expone DELETE /shops/:shopId/categorias/:id solo para el ADMINISTRADOR', () => {
      expect(CONTROLADOR).toMatch(/@Delete\(':id'\)/);
      const bloque = CONTROLADOR.slice(CONTROLADOR.search(/@Delete\(':id'\)/));
      const cabecera = bloque.slice(0, bloque.indexOf('eliminar(') + 20);
      expect(cabecera).toMatch(/@Roles\('ADMINISTRADOR'\)/);
      expect(cabecera).toMatch(/VinculoBarberiaGuard/);
    });
  });
});
