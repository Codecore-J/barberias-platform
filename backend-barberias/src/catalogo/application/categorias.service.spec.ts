import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CategoriasService } from './categorias.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * V3 · Categorías de servicio de la sede.
 *
 * Lo que se comprueba aquí no es el CRUD, es el TENANT y la nomenclatura: una
 * categoría pertenece a UNA sede (nunca se puede crear ni editar la de otra),
 * el nombre se normaliza y la desactivación no borra nada (§9).
 */
describe('CategoriasService', () => {
  let service: CategoriasService;

  const SEDE = '11111111-1111-4111-8111-111111111111';
  const OTRA_SEDE = '22222222-2222-4222-8222-222222222222';
  const CATEGORIA = '33333333-3333-4333-8333-333333333333';

  const prisma = {
    categoriaServicio: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CategoriasService>(CategoriasService);
  });

  function categoriaBase(extra: Record<string, unknown> = {}) {
    return {
      id: CATEGORIA,
      barberiaId: SEDE,
      nombre: 'Corte',
      descripcion: null,
      activa: true,
      creadoAt: new Date(),
      actualizadoAt: new Date(),
      ...extra,
    };
  }

  describe('crear', () => {
    it('crea la categoría en la sede de la ruta y normaliza el nombre', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);
      prisma.categoriaServicio.create.mockResolvedValue(categoriaBase());

      const resultado = await service.crear(SEDE, {
        nombre: '  Corte   clásico ',
        descripcion: '  Tijera y máquina  ',
      });

      expect(prisma.categoriaServicio.create).toHaveBeenCalledWith({
        data: {
          barberiaId: SEDE,
          nombre: 'Corte clásico',
          descripcion: 'Tijera y máquina',
        },
      });
      expect(resultado.id).toBe(CATEGORIA);
    });

    it('rechaza una categoría duplicada en la misma sede (409 CATEGORIA_DUPLICADA)', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue({
        id: CATEGORIA,
        nombre: 'Corte',
        activa: true,
      });

      await expect(service.crear(SEDE, { nombre: 'corte' })).rejects.toMatchObject({
        response: { codigo: 'CATEGORIA_DUPLICADA' },
      });
      expect(prisma.categoriaServicio.create).not.toHaveBeenCalled();
    });

    it('la comprobación de duplicados se acota a la sede', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);
      prisma.categoriaServicio.create.mockResolvedValue(categoriaBase());

      await service.crear(SEDE, { nombre: 'Corte' });

      expect(prisma.categoriaServicio.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            barberiaId: SEDE,
            nombre: { equals: 'Corte', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('sin sede responde 400 en lugar de crear en «ninguna» sede', async () => {
      await expect(service.crear('', { nombre: 'Corte' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.categoriaServicio.create).not.toHaveBeenCalled();
    });

    it('un nombre en blanco es un 400, no una categoría vacía', async () => {
      await expect(service.crear(SEDE, { nombre: '   ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listar', () => {
    it('devuelve las categorías de la sede con el número de servicios activos', async () => {
      prisma.categoriaServicio.findMany.mockResolvedValue([
        categoriaBase({ servicios: [{ id: 's1' }, { id: 's2' }] }),
        categoriaBase({ id: 'cat-2', nombre: 'Barba', activa: false, servicios: [] }),
      ]);

      const resultado = await service.listar(SEDE);

      expect(prisma.categoriaServicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barberiaId: SEDE } }),
      );
      expect(resultado).toEqual([
        expect.objectContaining({ id: CATEGORIA, serviciosActivos: 2 }),
        expect.objectContaining({ id: 'cat-2', serviciosActivos: 0 }),
      ]);
      // El conteo no debe filtrarse al cliente como array de servicios.
      expect(resultado[0]).not.toHaveProperty('servicios');
    });
  });

  describe('actualizar', () => {
    it('no encuentra una categoría de otra sede', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(null);

      await expect(
        service.actualizar(OTRA_SEDE, CATEGORIA, { nombre: 'Barba' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.categoriaServicio.update).not.toHaveBeenCalled();
    });

    it('renombra cuando el nombre nuevo no choca con otro de la sede', async () => {
      prisma.categoriaServicio.findFirst
        .mockResolvedValueOnce(categoriaBase({ servicios: [] })) // obtener
        .mockResolvedValueOnce(null); // exigirNombreLibre
      prisma.categoriaServicio.update.mockResolvedValue(categoriaBase({ nombre: 'Barba' }));

      const resultado = await service.actualizar(SEDE, CATEGORIA, { nombre: 'Barba' });

      expect(prisma.categoriaServicio.update).toHaveBeenCalledWith({
        where: { id: CATEGORIA },
        data: { nombre: 'Barba' },
      });
      expect(resultado.nombre).toBe('Barba');
    });

    it('excluye la propia categoría al comprobar el duplicado', async () => {
      prisma.categoriaServicio.findFirst
        .mockResolvedValueOnce(categoriaBase({ servicios: [] }))
        .mockResolvedValueOnce(null);
      prisma.categoriaServicio.update.mockResolvedValue(categoriaBase({ nombre: 'Corte fino' }));

      await service.actualizar(SEDE, CATEGORIA, { nombre: 'Corte fino' });

      expect(prisma.categoriaServicio.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: CATEGORIA }, barberiaId: SEDE }),
        }),
      );
    });

    it('desactiva en lugar de borrar (§9) y es idempotente al no haber cambios', async () => {
      prisma.categoriaServicio.findFirst.mockResolvedValue(categoriaBase({ servicios: [] }));
      prisma.categoriaServicio.update.mockResolvedValue(categoriaBase({ activa: false }));

      await service.actualizar(SEDE, CATEGORIA, { activa: false });

      expect(prisma.categoriaServicio.update).toHaveBeenCalledWith({
        where: { id: CATEGORIA },
        data: { activa: false },
      });

      // Sin campos que escribir no se toca la fila.
      const sinCambios = await service.actualizar(SEDE, CATEGORIA, {});
      expect(sinCambios.activa).toBe(true);
    });

    it('propaga el 409 cuando el nombre nuevo ya existe en la sede', async () => {
      prisma.categoriaServicio.findFirst
        .mockResolvedValueOnce(categoriaBase({ servicios: [] }))
        .mockResolvedValueOnce({ id: 'otra', nombre: 'Barba', activa: true });

      const error = await service
        .actualizar(SEDE, CATEGORIA, { nombre: 'Barba' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ codigo: 'CATEGORIA_DUPLICADA' });
    });
  });
});
