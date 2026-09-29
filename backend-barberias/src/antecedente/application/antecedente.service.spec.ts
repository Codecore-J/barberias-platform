import { Test, TestingModule } from '@nestjs/testing';
import { AntecedenteService } from './antecedente.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DecisionAntecedente } from './dto/evaluar-antecedente.dto.js';

describe('AntecedenteService', () => {
  let service: AntecedenteService;

  const mockPrismaService = {
    barberia: { findUnique: vi.fn() },
    usuario: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    antecedente: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AntecedenteService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AntecedenteService>(AntecedenteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('crear', () => {
    const usuarioId = 'uuid-barbero';
    const barberiaId = 'uuid-barberia';
    const clienteId = 'uuid-cliente';

    it('debe permitir a un barbero registrar un antecedente en estado PENDIENTE con origen BARBERO', async () => {
      // 1. Acceso: Barbero
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'uuid-otro-dueno',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { rol: { nombre: 'BARBERO' } },
      ]);

      // 2. Cliente existe
      mockPrismaService.usuario.findUnique.mockResolvedValue({
        id: clienteId,
        nombreCompleto: 'Juan Cliente',
      });

      // 3. Creación
      const mockCreated = {
        id: 'uuid-ant',
        usuarioId: clienteId,
        barberiaOrigenId: barberiaId,
        categoria: 'TECNICA',
        contenido: 'Piel sensible en cuello',
        origen: 'BARBERO',
        estadoValidacion: 'PENDIENTE',
        compartido: false,
      };
      mockPrismaService.antecedente.create.mockResolvedValue(mockCreated);

      const res = await service.crear(usuarioId, barberiaId, {
        usuarioId: clienteId,
        categoria: 'TECNICA',
        contenido: 'Piel sensible en cuello',
      });

      expect(res).toEqual(mockCreated);
      expect(mockPrismaService.antecedente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          usuarioId: clienteId,
          barberiaOrigenId: barberiaId,
          origen: 'BARBERO',
          estadoValidacion: 'PENDIENTE',
        }),
      });
    });

    it('debe permitir a un admin registrar un antecedente con origen ADMIN', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId, // Es el dueño
      });
      mockPrismaService.usuario.findUnique.mockResolvedValue({ id: clienteId });
      mockPrismaService.antecedente.create.mockResolvedValue({
        id: 'uuid-ant-2',
        origen: 'ADMIN',
      });

      const res = await service.crear(usuarioId, barberiaId, {
        usuarioId: clienteId,
        categoria: 'CONDUCTA',
        contenido: 'Excelente puntualidad',
      });

      expect(mockPrismaService.antecedente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          origen: 'ADMIN',
          estadoValidacion: 'PENDIENTE',
        }),
      });
    });

    it('debe fallar con NotFoundException si el cliente no existe', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.crear(usuarioId, barberiaId, {
          usuarioId: 'cliente-inexistente',
          categoria: 'GENERAL',
          contenido: 'Test',
        }),
      ).rejects.toThrowError(NotFoundException);
    });

    it('debe fallar con ForbiddenException si el usuario no tiene permisos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'otro',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);

      await expect(
        service.crear('usuario-externo', barberiaId, {
          usuarioId: clienteId,
          categoria: 'GENERAL',
          contenido: 'Test',
        }),
      ).rejects.toThrowError(ForbiddenException);
    });
  });

  describe('evaluar (T7.1)', () => {
    const adminId = 'uuid-admin';
    const barberiaId = 'uuid-barberia';
    const antecedenteId = 'uuid-ant';

    it('debe permitir a un admin aprobar un antecedente pendiente', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });
      mockPrismaService.antecedente.findFirst.mockResolvedValue({
        id: antecedenteId,
        barberiaOrigenId: barberiaId,
        estadoValidacion: 'PENDIENTE',
      });
      mockPrismaService.antecedente.update.mockResolvedValue({
        id: antecedenteId,
        estadoValidacion: 'APROBADO',
        motivoRechazo: null,
      });

      const res = await service.evaluar(adminId, barberiaId, antecedenteId, {
        decision: DecisionAntecedente.APROBADO,
      });

      expect(res.estadoValidacion).toBe('APROBADO');
      expect(mockPrismaService.antecedente.update).toHaveBeenCalledWith({
        where: { id: antecedenteId },
        data: {
          estadoValidacion: 'APROBADO',
          motivoRechazo: null,
        },
      });
    });

    it('debe permitir a un admin rechazar un antecedente con motivo', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });
      mockPrismaService.antecedente.findFirst.mockResolvedValue({
        id: antecedenteId,
        barberiaOrigenId: barberiaId,
        estadoValidacion: 'PENDIENTE',
      });
      mockPrismaService.antecedente.update.mockResolvedValue({
        id: antecedenteId,
        estadoValidacion: 'RECHAZADO',
        motivoRechazo: 'Lenguaje inapropiado en la observación',
      });

      const res = await service.evaluar(adminId, barberiaId, antecedenteId, {
        decision: DecisionAntecedente.RECHAZADO,
        motivoRechazo: 'Lenguaje inapropiado en la observación',
      });

      expect(res.estadoValidacion).toBe('RECHAZADO');
      expect(mockPrismaService.antecedente.update).toHaveBeenCalledWith({
        where: { id: antecedenteId },
        data: {
          estadoValidacion: 'RECHAZADO',
          motivoRechazo: 'Lenguaje inapropiado en la observación',
        },
      });
    });

    it('debe rechazar con ForbiddenException si un barbero común intenta evaluar', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'otro-dueno',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      // Solo rol BARBERO, no es ADMIN
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { rol: { nombre: 'BARBERO' } },
      ]);

      await expect(
        service.evaluar('barbero-id', barberiaId, antecedenteId, {
          decision: DecisionAntecedente.APROBADO,
        }),
      ).rejects.toThrowError(ForbiddenException);
    });

    it('debe rechazar con BadRequestException si el antecedente ya fue evaluado', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });
      mockPrismaService.antecedente.findFirst.mockResolvedValue({
        id: antecedenteId,
        barberiaOrigenId: barberiaId,
        estadoValidacion: 'APROBADO', // Ya evaluado
      });

      await expect(
        service.evaluar(adminId, barberiaId, antecedenteId, {
          decision: DecisionAntecedente.APROBADO,
        }),
      ).rejects.toThrowError(BadRequestException);
    });

    it('debe lanzar NotFoundException si el antecedente no existe', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });
      mockPrismaService.antecedente.findFirst.mockResolvedValue(null);

      await expect(
        service.evaluar(adminId, barberiaId, 'ant-inexistente', {
          decision: DecisionAntecedente.APROBADO,
        }),
      ).rejects.toThrowError(NotFoundException);
    });
  });

  describe('listarPendientes y listarPorCliente', () => {
    const adminId = 'uuid-admin';
    const barberiaId = 'uuid-barberia';

    it('debe listar antecedentes pendientes para el administrador', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });
      mockPrismaService.antecedente.findMany.mockResolvedValue([
        { id: 'ant-1', estadoValidacion: 'PENDIENTE' },
      ]);

      const res = await service.listarPendientes(adminId, barberiaId);
      expect(res).toHaveLength(1);
      expect(mockPrismaService.antecedente.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            barberiaOrigenId: barberiaId,
            estadoValidacion: 'PENDIENTE',
          },
        }),
      );
    });

    it('debe listar antecedentes propios sin enmascarar y enmascarar estrictamente antecedentes de otras barberías (T7.2)', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: adminId,
      });

      const mockData = [
        // 1. Antecedente propio de esta barbería
        {
          id: 'ant-propio',
          usuarioId: 'cliente-1',
          barberiaOrigenId: barberiaId,
          categoria: 'TECNICA',
          contenido: 'Corte con tijera fina',
          origen: 'BARBERO',
          estadoValidacion: 'APROBADO',
          compartido: true,
          motivoRechazo: null,
          creadoAt: new Date(),
          usuario: {
            id: 'cliente-1',
            nombreCompleto: 'Carlos Mendoza',
            correo: 'carlos@test.com',
            telefono: '18095551234',
          },
          barberiaOrigen: { id: barberiaId, nombre: 'Barbería Central' },
        },
        // 2. Antecedente externo compartido de otra barbería
        {
          id: 'ant-externo',
          usuarioId: 'cliente-1',
          barberiaOrigenId: 'otra-barberia-uuid',
          categoria: 'CONDUCTA',
          contenido: 'Cliente puntual y amable',
          origen: 'BARBERO',
          estadoValidacion: 'APROBADO',
          compartido: true,
          motivoRechazo: null,
          creadoAt: new Date(),
          usuario: {
            id: 'cliente-1',
            nombreCompleto: 'Carlos Mendoza',
            correo: 'carlos@test.com',
            telefono: '18095551234',
          },
          barberiaOrigen: { id: 'otra-barberia-uuid', nombre: 'Barbería Norte' },
        },
      ];

      mockPrismaService.antecedente.findMany.mockResolvedValue(mockData);

      const res = await service.listarPorCliente(adminId, barberiaId, 'cliente-1');
      expect(res).toHaveLength(2);

      // Verificación de registro propio (no anonimizado)
      const propio = res.find((r) => r.id === 'ant-propio');
      expect(propio?.origenBarberia).toBe('PROPIA');
      expect(propio?.barberiaOrigenId).toBe(barberiaId);
      expect(propio?.cliente.esAnonimizado).toBe(false);
      expect(propio?.cliente.nombreCompleto).toBe('Carlos Mendoza');
      expect(propio?.cliente.correo).toBe('carlos@test.com');
      expect(propio?.cliente.telefono).toBe('18095551234');

      // Verificación de registro externo (ANONIMIZADO estrictamente T7.2)
      const externo = res.find((r) => r.id === 'ant-externo');
      expect(externo?.origenBarberia).toBe('EXTERNA');
      expect(externo?.barberiaOrigenId).toBeNull(); // Oculta UUID del tenant ajeno
      expect(externo?.nombreBarberiaOrigen).toBe('Red de Barberías (Aliada)');
      expect(externo?.cliente.esAnonimizado).toBe(true);
      expect(externo?.cliente.nombreCompleto).toBe('C*** M***');
      expect(externo?.cliente.correo).toBe('ca***@test.com');
      expect(externo?.cliente.telefono).toBe('*******1234');
    });
  });
});
