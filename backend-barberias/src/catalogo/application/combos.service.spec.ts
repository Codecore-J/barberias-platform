import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CombosService } from './combos.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * E1-06 · el `where` de combos lleva `barberiaId` como campoRequired.
 *
 * En Prisma, `where: { barberiaId: undefined }` NO filtra: el motor descarta el
 * campo y la consulta sale para todas las sedes. Por eso aqui se comprueba, sobre
 * la llamada realmente registrada, que el filtro viaja siempre con un string.
 */
describe('CombosService · filtro de sede (E1-06)', () => {
  let service: CombosService;
  let prisma: {
    combo: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const SEDE_A = 'sede-a';
  const COMBO_B = 'combo-de-la-sede-b';

  beforeEach(async () => {
    prisma = {
      combo: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CombosService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CombosService>(CombosService);
  });

  it('findAll acota siempre el where a la sede recibida', async () => {
    prisma.combo.findMany.mockResolvedValue([]);

    await service.findAll(SEDE_A);

    expect(prisma.combo.findMany).toHaveBeenCalledWith({
      where: { barberiaId: SEDE_A, estado: 'ACTIVO' },
      include: { comboItemsAsParent: true },
      orderBy: { nombre: 'asc' },
    });
  });

  it('findAll para cliente devuelve solo ACTIVOS', async () => {
    prisma.combo.findMany.mockResolvedValue([]);
    const usuario = {
      id: 'u1',
      correo: 'c@test.com',
      roles: ['CLIENTE'],
      rolesDetallados: [],
    } as any;
    await service.findAll(SEDE_A, usuario);
    expect(prisma.combo.findMany).toHaveBeenCalledWith({
      where: { barberiaId: SEDE_A, estado: 'ACTIVO' },
      include: { comboItemsAsParent: true },
      orderBy: { nombre: 'asc' },
    });
  });

  it('findAll para ADMIN_BARBERIA de la sede devuelve TODOS', async () => {
    prisma.combo.findMany.mockResolvedValue([]);
    const usuario = {
      id: 'u2',
      correo: 'a@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [{
        nombre: 'ADMIN_BARBERIA',
        barberiaId: SEDE_A,
        ambito: 'BARBERIA',
      }],
    } as any;
    await service.findAll(SEDE_A, usuario);
    expect(prisma.combo.findMany).toHaveBeenCalledWith({
      where: { barberiaId: SEDE_A },
      include: { comboItemsAsParent: true },
      orderBy: { nombre: 'asc' },
    });
  });

  it('findAll para ADMINISTRADOR global devuelve TODOS', async () => {
    prisma.combo.findMany.mockResolvedValue([]);
    const usuario = {
      id: 'u3',
      correo: 'g@test.com',
      roles: ['ADMINISTRADOR'],
      rolesDetallados: [],
    } as any;
    await service.findAll(SEDE_A, usuario);
    expect(prisma.combo.findMany).toHaveBeenCalledWith({
      where: { barberiaId: SEDE_A },
      include: { comboItemsAsParent: true },
      orderBy: { nombre: 'asc' },
    });
  });

  it('findAll NO lista los combos de otras sedes cuando la sede no llega', async () => {
    prisma.combo.findMany.mockResolvedValue([]);

    await expect(service.findAll(undefined as unknown as string)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.findAll('')).rejects.toThrow(BadRequestException);

    // Sin excepcion no debe haber ninguna consulta sin sede: seria la fuga.
    expect(prisma.combo.findMany).not.toHaveBeenCalled();
  });

  it('findOne exige sede y cruza id + barberiaId en el mismo where', async () => {
    prisma.combo.findFirst.mockResolvedValue(null);

    await expect(service.findOne(undefined as unknown as string, COMBO_B)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.combo.findFirst).not.toHaveBeenCalled();

    await expect(service.findOne(SEDE_A, COMBO_B)).rejects.toThrow(NotFoundException);
    expect(prisma.combo.findFirst).toHaveBeenCalledWith({
      where: { id: COMBO_B, barberiaId: SEDE_A },
      include: { comboItemsAsParent: true },
    });
  });
});
