import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CajaService } from './caja.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';

/**
 * V3 fase 6 · la caja del día y su cierre.
 *
 * El reloj se fija a las 20:00Z del 2026-10-10: en Santo Domingo (UTC-4) son las
 * 16:00 del día 10, así que la ventana del arqueo va de 04:00Z del 10 a 04:00Z
 * del 11. Es la comprobación de que el día es el de la SEDE y no el de UTC.
 */
const TZ_SEDE = ZONA_POR_DEFECTO;
const AHORA = new Date('2026-10-10T20:00:00.000Z');
const INICIO_DEL_DIA = new Date('2026-10-10T04:00:00.000Z');
const FIN_DEL_DIA = new Date('2026-10-11T04:00:00.000Z');

const tiempoReal = new TiempoService();
const mockTiempo = {
  ahora: vi.fn(() => AHORA),
  aInstante: (fecha: string, hora: string, tz?: string) => tiempoReal.aInstante(fecha, hora, tz),
  sumarDias: (fecha: string, dias: number) => tiempoReal.sumarDias(fecha, dias),
  fechaLocal: (instante: Date, tz?: string) => tiempoReal.fechaLocal(instante, tz),
  fechaDeCalendario: (fecha: string) => tiempoReal.fechaDeCalendario(fecha),
};

describe('CajaService', () => {
  let service: CajaService;

  const mockPrismaService = {
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn() },
    pago: { findMany: vi.fn() },
    cierreCaja: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(mockPrismaService)),
  };

  const mockAuditoriaService = {
    registrarEvento: vi.fn().mockResolvedValue({ id: 'uuid-audit' }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockTiempo.ahora.mockReturnValue(AHORA);
    // Por defecto, el usuario es el responsable de la sede.
    mockPrismaService.barberia.findUnique.mockResolvedValue({
      responsableId: 'uuid-admin',
      zonaHoraria: TZ_SEDE,
    });
    mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
    mockPrismaService.cierreCaja.findUnique.mockResolvedValue(null);
    mockPrismaService.pago.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditoriaService, useValue: mockAuditoriaService },
        { provide: TiempoService, useValue: mockTiempo },
      ],
    }).compile();

    service = module.get<CajaService>(CajaService);
  });

  describe('hoy', () => {
    it('suma por método los pagos vivos del día de la sede', async () => {
      mockPrismaService.pago.findMany.mockResolvedValue([
        { monto: 30, metodoPago: 'EFECTIVO' },
        { monto: 20.5, metodoPago: 'TARJETA' },
        { monto: 12.25, metodoPago: 'TRANSFERENCIA' },
      ]);

      const resultado = await service.hoy('uuid-admin', 'uuid-sede');

      expect(resultado.estado).toBe('ABIERTO');
      expect(resultado.fecha).toBe('2026-10-10');
      expect(resultado.totales).toEqual({
        efectivo: 30,
        tarjeta: 20.5,
        transferencia: 12.25,
        general: 62.75,
        cantidadPagos: 3,
      });
    });

    it('consulta SOLO los pagos PAGADOS de la ventana local y de esa sede', async () => {
      await service.hoy('uuid-admin', 'uuid-sede');

      expect(mockPrismaService.pago.findMany).toHaveBeenCalledWith({
        where: {
          barberiaId: 'uuid-sede',
          estadoPago: 'PAGADA',
          registradoAt: { gte: INICIO_DEL_DIA, lt: FIN_DEL_DIA },
        },
        select: { monto: true, metodoPago: true },
      });
    });

    it('pliega el método histórico EN_PERSONA en efectivo', async () => {
      mockPrismaService.pago.findMany.mockResolvedValue([
        { monto: 15, metodoPago: 'EN_PERSONA' },
        { monto: 5, metodoPago: null },
      ]);

      const resultado = await service.hoy('uuid-admin', 'uuid-sede');

      expect(resultado.totales.efectivo).toBe(20);
      expect(resultado.totales.general).toBe(20);
    });

    it('redondea a dos decimales: 0.1 + 0.2 no puede dejar 0.30000000000000004', async () => {
      mockPrismaService.pago.findMany.mockResolvedValue([
        { monto: 0.1, metodoPago: 'EFECTIVO' },
        { monto: 0.2, metodoPago: 'EFECTIVO' },
      ]);

      const resultado = await service.hoy('uuid-admin', 'uuid-sede');

      expect(resultado.totales.efectivo).toBe(0.3);
    });

    it('si ya hay cierre devuelve SUS cifras y no vuelve a leer los pagos', async () => {
      mockPrismaService.cierreCaja.findUnique.mockResolvedValue({
        id: 'uuid-cierre',
        barberiaId: 'uuid-sede',
        fechaArqueo: new Date('2026-10-10T00:00:00.000Z'),
        totalEfectivo: 100,
        totalTarjeta: 50,
        totalTransferencia: 25,
        totalGeneral: 175,
        estado: 'CERRADO',
        cerradoAt: new Date('2026-10-10T23:00:00.000Z'),
      });

      const resultado = await service.hoy('uuid-admin', 'uuid-sede');

      expect(resultado.estado).toBe('CERRADO');
      expect(resultado.totales).toMatchObject({
        efectivo: 100,
        tarjeta: 50,
        transferencia: 25,
        general: 175,
        cantidadPagos: null,
      });
      expect(resultado.cierre?.fecha).toBe('2026-10-10');
      expect(mockPrismaService.pago.findMany).not.toHaveBeenCalled();
    });

    it('un ADMIN_BARBERIA de la sede consulta aunque no sea el responsable', async () => {
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue({ id: 'uuid-rol' });

      await expect(service.hoy('uuid-admin-sede', 'uuid-sede')).resolves.toBeDefined();
    });

    it('rechaza con 403 a quien no administra la sede', async () => {
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);

      await expect(service.hoy('uuid-barbero', 'uuid-sede')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('responde 404 si la sede no existe', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue(null);

      await expect(service.hoy('uuid-admin', 'uuid-sede')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cerrar', () => {
    it('congela los totales del día y audita el cierre', async () => {
      mockPrismaService.pago.findMany.mockResolvedValue([
        { monto: 40, metodoPago: 'EFECTIVO' },
        { monto: 60, metodoPago: 'TARJETA' },
      ]);
      mockPrismaService.cierreCaja.create.mockImplementation(async ({ data }: any) => ({
        id: 'uuid-cierre',
        cerradoAt: new Date('2026-10-10T20:00:00.000Z'),
        ...data,
      }));

      const resultado = await service.cerrar('uuid-admin', 'uuid-sede');

      expect(resultado.estado).toBe('CERRADO');
      expect(resultado.totales).toMatchObject({
        efectivo: 40,
        tarjeta: 60,
        transferencia: 0,
        general: 100,
      });
      expect(mockPrismaService.cierreCaja.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barberiaId: 'uuid-sede',
          totalEfectivo: 40,
          totalTarjeta: 60,
          totalTransferencia: 0,
          totalGeneral: 100,
          estado: 'CERRADO',
          cerradoPor: 'uuid-admin',
        }),
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'CIERRE_CAJA',
          entidad: 'CIERRE_CAJA',
          entidadId: 'uuid-cierre',
        }),
        mockPrismaService,
      );
    });

    it('no cierra dos veces el mismo día: 409 CAJA_YA_CERRADA', async () => {
      mockPrismaService.cierreCaja.findUnique.mockResolvedValue({
        id: 'uuid-cierre',
        cerradoAt: new Date('2026-10-10T19:00:00.000Z'),
      });

      await expect(service.cerrar('uuid-admin', 'uuid-sede')).rejects.toMatchObject({
        status: 409,
        response: { codigo: 'CAJA_YA_CERRADA' },
      });
      expect(mockPrismaService.cierreCaja.create).not.toHaveBeenCalled();
    });

    it('traduce la carrera de dos cierres (P2002) a 409', async () => {
      mockPrismaService.cierreCaja.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(service.cerrar('uuid-admin', 'uuid-sede')).rejects.toMatchObject({
        status: 409,
        response: { codigo: 'CAJA_YA_CERRADA' },
      });
    });

    it('un BARBERO no cierra la caja de la sede', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'uuid-otro',
        zonaHoraria: TZ_SEDE,
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);

      await expect(service.cerrar('uuid-barbero', 'uuid-sede')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrismaService.cierreCaja.create).not.toHaveBeenCalled();
    });
  });
});
