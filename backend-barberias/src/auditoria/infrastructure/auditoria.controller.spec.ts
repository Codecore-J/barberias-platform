import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AuditoriaController } from './auditoria.controller.js';
import { AuditoriaService } from '../application/auditoria.service.js';

describe('AuditoriaController (T8.2)', () => {
  let controller: AuditoriaController;
  let service: AuditoriaService;

  const mockAuditoriaService = {
    obtenerEstadisticas: vi.fn(),
    purgarAuditoriasAntiguas: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditoriaController],
      providers: [
        {
          provide: AuditoriaService,
          useValue: mockAuditoriaService,
        },
      ],
    }).compile();

    controller = module.get<AuditoriaController>(AuditoriaController);
    service = module.get<AuditoriaService>(AuditoriaService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  describe('obtenerEstadisticas', () => {
    it('debe delegar en auditoriaService.obtenerEstadisticas()', async () => {
      const mockStats = {
        totalRegistros: 120,
        registroMasAntiguo: new Date('2025-01-01'),
        registroMasReciente: new Date('2026-09-28'),
        politicaRetencionDias: 365,
      };
      mockAuditoriaService.obtenerEstadisticas.mockResolvedValue(mockStats);

      const result = await controller.obtenerEstadisticas();

      expect(mockAuditoriaService.obtenerEstadisticas).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStats);
    });
  });

  describe('ejecutarPurgaManual', () => {
    it('debe usar 365 días por defecto si no se pasa parámetro', async () => {
      const mockResult = { registrosEliminados: 25, fechaCorte: new Date() };
      mockAuditoriaService.purgarAuditoriasAntiguas.mockResolvedValue(mockResult);

      const result = await controller.ejecutarPurgaManual();

      expect(mockAuditoriaService.purgarAuditoriasAntiguas).toHaveBeenCalledWith(365);
      expect(result).toEqual(mockResult);
    });

    it('debe parsear el parámetro días correctamente cuando se envía', async () => {
      const mockResult = { registrosEliminados: 10, fechaCorte: new Date() };
      mockAuditoriaService.purgarAuditoriasAntiguas.mockResolvedValue(mockResult);

      const result = await controller.ejecutarPurgaManual('180');

      expect(mockAuditoriaService.purgarAuditoriasAntiguas).toHaveBeenCalledWith(180);
      expect(result).toEqual(mockResult);
    });
  });
});
