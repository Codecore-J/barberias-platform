import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ServiciosBarberoService } from './servicios-barbero.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * V3 · Servicios propios del barbero.
 *
 * El eje de estas pruebas es la IDENTIDAD: el `barberoId` sale del JWT, la
 * categoría tiene que ser de la misma sede y un servicio de otro barbero no se
 * puede editar (404, no 403: el panel no confirma recursos ajenos).
 */
describe('ServiciosBarberoService', () => {
  let service: ServiciosBarberoService;

  const SEDE = '11111111-1111-4111-8111-111111111111';
  const OTRA_SEDE = '22222222-2222-4222-8222-222222222222';
  const BARBERO = '44444444-4444-4444-8444-444444444444';
  const CATEGORIA = '33333333-3333-4333-8333-333333333333';
  const CATEGORIA_2 = '66666666-6666-4666-8666-666666666666';
  const SERVICIO = '77777777-7777-4777-8777-777777777777';

  const prisma = {
    categoriaServicio: { findFirst: vi.fn(), findMany: vi.fn() },
    usuarioRol: { findFirst: vi.fn() },
    servicioBarbero: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiciosBarberoService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ServiciosBarberoService>(ServiciosBarberoService);
  });

  function conRolBarbero(estadoCuenta = 'ACTIVO') {
    prisma.usuarioRol.findFirst.mockResolvedValue({
      usuario: { nombreCompleto: 'Carlos', estadoCuenta },
    });
  }

  function conCategoria(categoria: Record<string, unknown> | null) {
    prisma.categoriaServicio.findFirst.mockResolvedValue(categoria);
  }

  describe('crear', () => {
    const dto = {
      nombre: '  Corte  degradado ',
      precio: 25.5,
      duracionMinutos: 30,
      categoriaId: CATEGORIA,
    };

    it('publica el servicio con el barbero del JWT y el nombre normalizado', async () => {
      conRolBarbero();
      conCategoria({ id: CATEGORIA, nombre: 'Corte', activa: true });
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);
      prisma.servicioBarbero.create.mockResolvedValue({
        id: SERVICIO,
        barberoId: BARBERO,
        categoriaId: CATEGORIA,
        nombrePersonalizado: 'Corte degradado',
      });

      const resultado = await service.crear(SEDE, BARBERO, dto);

      expect(prisma.servicioBarbero.create).toHaveBeenCalledWith({
        data: {
          barberoId: BARBERO,
          categoriaId: CATEGORIA,
          nombrePersonalizado: 'Corte degradado',
          precio: 25.5,
          duracionMinutos: 30,
        },
        include: { categoria: { select: { id: true, nombre: true } } },
      });
      expect(resultado.id).toBe(SERVICIO);
    });

    it('exige el rol BARBERO en esa sede (403 BARBERO_NO_PERTENECE_A_SEDE)', async () => {
      prisma.usuarioRol.findFirst.mockResolvedValue(null);

      const error = await service.crear(SEDE, BARBERO, dto).catch((e) => e);

      expect(error).toMatchObject({
        response: { codigo: 'BARBERO_NO_PERTENECE_A_SEDE' },
      });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('la pertenencia se consulta contra la sede de la ruta', async () => {
      conRolBarbero();
      conCategoria({ id: CATEGORIA, nombre: 'Corte', activa: true });
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);
      prisma.servicioBarbero.create.mockResolvedValue({ id: SERVICIO });

      await service.crear(SEDE, BARBERO, dto);

      expect(prisma.usuarioRol.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            usuarioId: BARBERO,
            barberiaId: SEDE,
            rol: { nombre: 'BARBERO' },
          }),
        }),
      );
    });

    it('una cuenta suspendida no publica servicios (422 BARBERO_INACTIVO)', async () => {
      conRolBarbero('SUSPENDIDO');

      const error = await service.crear(SEDE, BARBERO, dto).catch((e) => e);

      expect(error).toMatchObject({ response: { codigo: 'BARBERO_INACTIVO' } });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('una categoría de otra sede no existe para este barbero (404)', async () => {
      conRolBarbero();
      conCategoria(null);

      await expect(service.crear(OTRA_SEDE, BARBERO, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.categoriaServicio.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CATEGORIA, barberiaId: OTRA_SEDE } }),
      );
    });

    it('una categoría desactivada no admite servicios nuevos (422 CATEGORIA_INACTIVA)', async () => {
      conRolBarbero();
      conCategoria({ id: CATEGORIA, nombre: 'Corte', activa: false });

      const error = await service.crear(SEDE, BARBERO, dto).catch((e) => e);

      expect(error).toMatchObject({ response: { codigo: 'CATEGORIA_INACTIVA' } });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('no permite dos servicios con el mismo nombre en la misma categoría', async () => {
      conRolBarbero();
      conCategoria({ id: CATEGORIA, nombre: 'Corte', activa: true });
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        nombrePersonalizado: 'Corte degradado',
        activo: true,
      });

      const error = await service.crear(SEDE, BARBERO, dto).catch((e) => e);

      expect(error).toMatchObject({ response: { codigo: 'SERVICIO_BARBERO_DUPLICADO' } });
      expect(prisma.servicioBarbero.create).not.toHaveBeenCalled();
    });

    it('sin sede responde 400', async () => {
      await expect(service.crear('', BARBERO, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listarMios', () => {
    it('acota a la sede por la relación de la categoría', async () => {
      prisma.servicioBarbero.findMany.mockResolvedValue([]);

      await service.listarMios(SEDE, BARBERO);

      expect(prisma.servicioBarbero.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barberoId: BARBERO, categoria: { barberiaId: SEDE } },
        }),
      );
    });
  });

  describe('actualizar', () => {
    it('un servicio de otro barbero responde 404 (no se confirma que exista)', async () => {
      prisma.servicioBarbero.findFirst.mockResolvedValue(null);

      await expect(
        service.actualizar(SEDE, BARBERO, SERVICIO, { precio: 30 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
    });

    it('la búsqueda exige barberoId propio y la sede de la categoría', async () => {
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        categoriaId: CATEGORIA,
        nombrePersonalizado: 'Corte',
        precio: 20,
        duracionMinutos: 30,
        activo: true,
      });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO, precio: 30 });

      await service.actualizar(SEDE, BARBERO, SERVICIO, { precio: 30 });

      expect(prisma.servicioBarbero.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: SERVICIO,
            barberoId: BARBERO,
            categoria: { barberiaId: SEDE },
          },
        }),
      );
    });

    it('mueve el servicio a otra categoría de la MISMA sede', async () => {
      prisma.servicioBarbero.findFirst
        .mockResolvedValueOnce({
          id: SERVICIO,
          categoriaId: CATEGORIA,
          nombrePersonalizado: 'Corte',
          precio: 20,
          duracionMinutos: 30,
          activo: true,
        }) // el servicio propio
        .mockResolvedValueOnce(null); // nombre libre en la categoría destino
      conCategoria({ id: CATEGORIA_2, nombre: 'Barba', activa: true });
      prisma.servicioBarbero.update.mockResolvedValue({
        id: SERVICIO,
        categoriaId: CATEGORIA_2,
      });

      await service.actualizar(SEDE, BARBERO, SERVICIO, { categoriaId: CATEGORIA_2 });

      expect(prisma.categoriaServicio.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CATEGORIA_2, barberiaId: SEDE } }),
      );
      expect(prisma.servicioBarbero.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { categoriaId: CATEGORIA_2 } }),
      );
    });

    it('desactiva con `activo: false` en lugar de borrar (§9)', async () => {
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        categoriaId: CATEGORIA,
        nombrePersonalizado: 'Corte',
        precio: 20,
        duracionMinutos: 30,
        activo: true,
      });
      prisma.servicioBarbero.update.mockResolvedValue({ id: SERVICIO, activo: false });

      await service.actualizar(SEDE, BARBERO, SERVICIO, { activo: false });

      expect(prisma.servicioBarbero.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SERVICIO }, data: { activo: false } }),
      );
    });

    it('no escribe nada si el payload viene vacío', async () => {
      prisma.servicioBarbero.findFirst.mockResolvedValue({
        id: SERVICIO,
        categoriaId: CATEGORIA,
        nombrePersonalizado: 'Corte',
        precio: 20,
        duracionMinutos: 30,
        activo: true,
      });

      await service.actualizar(SEDE, BARBERO, SERVICIO, {});

      expect(prisma.servicioBarbero.update).not.toHaveBeenCalled();
    });
  });

  describe('catalogoAnidado', () => {
    it('devuelve categorías con servicios activos y el barbero de cada uno', async () => {
      prisma.categoriaServicio.findMany.mockResolvedValue([
        {
          id: CATEGORIA,
          nombre: 'Corte',
          descripcion: 'Tijera y máquina',
          servicios: [
            {
              id: SERVICIO,
              nombrePersonalizado: 'Corte degradado',
              precio: 25,
              duracionMinutos: 30,
              barbero: { id: BARBERO, nombreCompleto: 'Carlos' },
            },
          ],
        },
        { id: CATEGORIA_2, nombre: 'Barba', descripcion: null, servicios: [] },
      ]);

      const resultado = await service.catalogoAnidado(SEDE);

      expect(prisma.categoriaServicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { barberiaId: SEDE, activa: true },
          include: expect.objectContaining({
            servicios: expect.objectContaining({ where: { activo: true } }),
          }),
        }),
      );

      // La categoría sin servicios activos no se muestra: el cliente no ve
      // secciones vacías.
      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toEqual({
        id: CATEGORIA,
        nombre: 'Corte',
        descripcion: 'Tijera y máquina',
        servicios: [
          {
            id: SERVICIO,
            nombre: 'Corte degradado',
            precio: 25,
            duracionMinutos: 30,
            barbero: { id: BARBERO, nombre: 'Carlos' },
          },
        ],
      });
    });

    it('sin sede responde 400 en lugar de devolver el catálogo de todas las sedes', async () => {
      await expect(service.catalogoAnidado(undefined as unknown as string)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.categoriaServicio.findMany).not.toHaveBeenCalled();
    });
  });
});
