import { Test, TestingModule } from '@nestjs/testing';
import { PagoService } from './pago.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

/**
 * E3-09/E2-04: el cobro solo completa una cita que YA empezó. La cita de prueba
 * es del 2026-10-10 a las 09:00 de la sede (13:00Z) y el reloj falso va una hora
 * por delante; los casos que necesiten lo contrario mueven `ahora`.
 */
const TZ_SEDE = ZONA_POR_DEFECTO;
const CITA_FECHA = new Date('2026-10-10T00:00:00.000Z');
const CITA_HORA = new Date('1970-01-01T09:00:00.000Z');
const AHORA_TRAS_EL_INICIO = new Date('2026-10-10T14:00:00.000Z');

const tiempoReal = new TiempoService();
const mockTiempo = {
  ahora: vi.fn(() => AHORA_TRAS_EL_INICIO),
  aInstante: (fecha: string, hora: string, tz?: string) => tiempoReal.aInstante(fecha, hora, tz),
};

describe('PagoService', () => {
  let service: PagoService;

  const mockPrismaService = {
    barberia: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    reserva: { findFirst: vi.fn(), update: vi.fn() },
    // H68: anular reescribe la fila del pago y el historial la lista.
    pago: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    auditoria: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrismaService)),
  };

  const mockAuditoriaService = {
    registrarEvento: vi.fn().mockResolvedValue({ id: 'uuid-audit' }),
    consultarAuditorias: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // El reloj falso sobrevive a `clearAllMocks`, así que se fija en cada caso.
    mockTiempo.ahora.mockReturnValue(AHORA_TRAS_EL_INICIO);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditoriaService, useValue: mockAuditoriaService },
        { provide: TiempoService, useValue: mockTiempo },
      ],
    }).compile();

    service = module.get<PagoService>(PagoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registrarPagoEnPersona', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';
    const reservaId = 'uuid-reserva';

    it('debe registrar el pago en persona exitosamente, marcar la reserva como COMPLETADA y crear auditoría', async () => {
      // 1. Acceso permitido (responsable)
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      // 2. Reserva encontrada en estado CONFIRMADA sin pago previo
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'CONFIRMADA',
        totalPagar: 25.0,
        pago: null,
        // E3-09: la condición de `hora_inicio` necesita las etiquetas de la cita
        // y la zona de la sede.
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });

      // 3. Upsert de pago
      const mockPago = {
        id: 'uuid-pago',
        reservaId,
        estadoPago: 'PAGADA',
        monto: 25.0,
        registradoPor: usuarioId,
      };
      mockPrismaService.pago.upsert.mockResolvedValue(mockPago);

      // 4. Update de reserva
      const mockReservaCompletada = {
        id: reservaId,
        estado: 'COMPLETADA',
      };
      mockPrismaService.reserva.update.mockResolvedValue(mockReservaCompletada);

      const result = await service.registrarPagoEnPersona(usuarioId, barberiaId, {
        reservaId,
        monto: 25.0,
        metodoPago: 'EFECTIVO',
      });

      expect(result.pago).toEqual(mockPago);
      expect(result.reserva.estado).toBe('COMPLETADA');
      expect(mockPrismaService.pago.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reservaId },
          create: expect.objectContaining({
            reservaId,
            estadoPago: 'PAGADA',
            monto: 25.0,
            registradoPor: usuarioId,
          }),
        }),
      );
      expect(mockPrismaService.reserva.update).toHaveBeenCalledWith({
        where: { id: reservaId },
        data: { estado: 'COMPLETADA', completadaAt: AHORA_TRAS_EL_INICIO },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId,
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          entidad: 'PAGO',
          entidadId: mockPago.id,
        }),
        expect.anything(),
      );
    });

    it('debe tomar totalPagar de la reserva si no se especifica monto en el DTO', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      // E3-09 (H47): una PENDIENTE ya NO se puede cobrar, así que este caso —que
      // prueba el monto por defecto— usa una CONFIRMADA que ya empezó. Que la
      // PENDIENTE falle tiene su propio caso más abajo.
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'CONFIRMADA',
        totalPagar: 35.5,
        pago: null,
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });

      mockPrismaService.pago.upsert.mockResolvedValue({
        id: 'uuid-pago',
        monto: 35.5,
      });
      mockPrismaService.reserva.update.mockResolvedValue({
        id: reservaId,
        estado: 'COMPLETADA',
      });

      await service.registrarPagoEnPersona(usuarioId, barberiaId, {
        reservaId,
      });

      expect(mockPrismaService.pago.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            monto: 35.5,
          }),
        }),
      );
    });

    it('debe lanzar ForbiddenException si el usuario no tiene permisos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'otro-usuario',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null); // No es ADMINISTRADOR
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]); // No tiene roles

      await expect(
        service.registrarPagoEnPersona('usuario-no-autorizado', barberiaId, {
          reservaId,
        }),
      ).rejects.toThrowError(ForbiddenException);
    });

    it('debe lanzar NotFoundException si la reserva no existe en la barbería', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue(null);

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId: 'reserva-inexistente',
        }),
      ).rejects.toThrowError(NotFoundException);
    });

    it('E3-09 (H47): una reserva CANCELADA no se cobra → 409 ESTADO_INVALIDO', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'CANCELADA',
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId,
        }),
      ).rejects.toMatchObject({
        response: { statusCode: 409, codigo: 'ESTADO_INVALIDO' },
      });
    });

    it('debe lanzar ConflictException si la reserva ya estaba PAGADA', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'COMPLETADA',
        pago: {
          estadoPago: 'PAGADA',
          monto: 20,
        },
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, {
          reservaId,
        }),
      ).rejects.toThrowError(ConflictException);
    });

    it('E3-09 §5.2 fila 11: cobrar una cita que aún NO empezó → 422 CITA_NO_INICIADA', async () => {
      // Una hora ANTES del inicio real (09:00 de la sede = 13:00Z).
      mockTiempo.ahora.mockReturnValue(new Date('2026-10-10T12:00:00.000Z'));
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'CONFIRMADA',
        totalPagar: 20,
        pago: null,
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, { reservaId }),
      ).rejects.toMatchObject({
        response: { statusCode: 422, codigo: 'CITA_NO_INICIADA' },
      });

      // Ni se cobró ni se completó nada.
      expect(mockPrismaService.pago.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('E3-09 (H47): una reserva PENDIENTE nunca aceptada tampoco se completa al cobrarla', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'PENDIENTE',
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
        pago: null,
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, { reservaId }),
      ).rejects.toMatchObject({
        response: { statusCode: 409, codigo: 'ESTADO_INVALIDO' },
      });
      expect(mockPrismaService.pago.upsert).not.toHaveBeenCalled();
    });

    /**
     * H68 · la corrección de un cobro. Anular NO borra nada: la fila queda
     * `ANULADO` con quién, cuándo y por qué, y la reserva conserva su
     * `COMPLETADA` (el servicio se prestó). Por eso el cajero que se equivoca
     * puede volver a cobrar la MISMA reserva: sin este camino, anular habría
     * sido un callejón sin salida.
     */
    it('H68: tras anular el pago, la sede puede volver a cobrar la misma reserva', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        estado: 'COMPLETADA',
        totalPagar: 25.0,
        // La fila del cobro anulado: sigue ahí, ya no es ingreso.
        pago: { id: 'uuid-pago', estadoPago: 'ANULADO', monto: 25.0 },
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });
      mockPrismaService.pago.upsert.mockResolvedValue({
        id: 'uuid-pago',
        reservaId,
        estadoPago: 'PAGADA',
        monto: 25.0,
      });

      const result = await service.registrarPagoEnPersona(usuarioId, barberiaId, {
        reservaId,
        monto: 25.0,
      });

      expect(result.pago.estadoPago).toBe('PAGADA');
      // El cobro vuelve a PAGADA sobre la MISMA fila: no nace un segundo pago.
      expect(mockPrismaService.pago.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reservaId },
          update: expect.objectContaining({ estadoPago: 'PAGADA' }),
        }),
      );
      // La reserva ya estaba COMPLETADA: no se reescribe su `completada_at`.
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
      // La auditoría deja constancia del estado previo REAL, no del de creación.
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          contexto: expect.objectContaining({
            estadoPrevioPago: 'ANULADO',
            nuevoEstadoPago: 'PAGADA',
          }),
        }),
        expect.anything(),
      );
    });

    it('H68: una reserva COMPLETADA con el cobro vivo sigue rechazando el segundo cobro', async () => {
      // Blindaje del camino anterior: solo una fila ANULADA reabre el cobro.
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        estado: 'COMPLETADA',
        pago: { estadoPago: 'PAGADA', monto: 25.0 },
      });

      await expect(
        service.registrarPagoEnPersona(usuarioId, barberiaId, { reservaId }),
      ).rejects.toThrowError(ConflictException);

      expect(mockPrismaService.pago.upsert).not.toHaveBeenCalled();
    });
  });

  describe('E3-09 · un BARBERO solo cobra reservas asignadas', () => {
    const barberoId = 'uuid-barbero-a';
    const barberiaId = 'uuid-barberia';
    const reservaId = 'uuid-reserva';

    /** El BARBERO de la sede: no es responsable, no es global, rol BARBERO en la sede. */
    function prepararBarbero() {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'uuid-otro-usuario',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null); // no es ADMINISTRADOR global
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { rol: { nombre: 'BARBERO' } },
      ]);
    }

    function prepararReservaAsignada(a: string | null) {
      mockPrismaService.reserva.findFirst.mockResolvedValue({
        id: reservaId,
        barberiaId,
        clienteId: 'uuid-cliente',
        barberoId: a,
        estado: 'CONFIRMADA',
        totalPagar: 30,
        pago: null,
        fechaCita: CITA_FECHA,
        horaInicio: CITA_HORA,
        barberia: { zonaHoraria: TZ_SEDE },
      });
      mockPrismaService.pago.upsert.mockResolvedValue({
        id: 'uuid-pago',
        reservaId,
        estadoPago: 'PAGADA',
        monto: 30,
        registradoPor: barberoId,
      });
      mockPrismaService.reserva.update.mockResolvedValue({
        id: reservaId,
        estado: 'COMPLETADA',
      });
    }

    it('rechaza con 403 cuando la reserva está asignada a OTRO barbero de la misma sede', async () => {
      prepararBarbero();
      prepararReservaAsignada('uuid-barbero-b');

      await expect(
        service.registrarPagoEnPersona(barberoId, barberiaId, { reservaId }),
      ).rejects.toThrowError(ForbiddenException);

      // Ni se crea el pago ni se completa la reserva.
      expect(mockPrismaService.pago.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.reserva.update).not.toHaveBeenCalled();
    });

    it('rechaza con 403 cuando la reserva NO tiene barbero asignado (decisión: asignar antes de cobrar)', async () => {
      prepararBarbero();
      prepararReservaAsignada(null);

      await expect(
        service.registrarPagoEnPersona(barberoId, barberiaId, { reservaId }),
      ).rejects.toThrowError(ForbiddenException);

      expect(mockPrismaService.pago.upsert).not.toHaveBeenCalled();
    });

    it('permite al BARBERO cobrar la reserva que SÍ tiene asignada (no es una regresión)', async () => {
      prepararBarbero();
      prepararReservaAsignada(barberoId);

      const result = await service.registrarPagoEnPersona(barberoId, barberiaId, {
        reservaId,
      });

      expect(result.reserva.estado).toBe('COMPLETADA');
      expect(mockPrismaService.pago.upsert).toHaveBeenCalled();
    });

    it('permite al ADMIN_BARBERIA cobrar una reserva sin asignar (el bypass de sede no cambia)', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'uuid-otro-usuario',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null); // no es ADMINISTRADOR global
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { rol: { nombre: 'ADMIN_BARBERIA' } },
      ]);
      prepararReservaAsignada(null);

      const result = await service.registrarPagoEnPersona('uuid-admin-barberia', barberiaId, {
        reservaId,
      });

      expect(result.reserva.estado).toBe('COMPLETADA');
    });
  });

  describe('obtenerAuditoriaPagos', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';
    const usuario = {
      id: usuarioId,
      correo: 'responsable@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId, ambito: 'BARBERIA' }],
    };

    it('debe validar permisos y retornar los registros de auditoría de pagos', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: usuarioId,
      });

      const mockAuditorias = {
        data: [
          {
            id: 'audit-1',
            accion: 'REGISTRO_PAGO_EN_PERSONA',
            entidad: 'PAGO',
            entidadId: 'pago-1',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      };
      mockAuditoriaService.consultarAuditorias.mockResolvedValue(mockAuditorias);

      const result = await service.obtenerAuditoriaPagos(usuario, barberiaId, 1, 50);

      expect(result).toEqual(mockAuditorias);
      expect(mockAuditoriaService.consultarAuditorias).toHaveBeenCalledWith(
        {
          entidad: 'PAGO',
          accion: 'REGISTRO_PAGO_EN_PERSONA',
          barberiaId,
          page: 1,
          pageSize: 50,
        },
        usuario,
      );
    });

    it('debe rechazar con 400 cuando no hay barbería y el usuario no es ADMINISTRADOR', async () => {
      const cliente: any = {
        id: 'uuid-cliente',
        correo: 'cliente@test.com',
        roles: ['CLIENTE'],
        rolesDetallados: [],
      };

      await expect(service.obtenerAuditoriaPagos(cliente, null, 1, 50)).rejects.toThrowError(
        BadRequestException,
      );

      expect(mockAuditoriaService.consultarAuditorias).not.toHaveBeenCalled();
    });
  });

  /**
   * H68 · §7.3: un pago puede corregirse después y cada corrección se audita.
   *
   * La anulación NO borra la fila (la skill del proyecto prohíbe el borrado para
   * representar un cambio de estado): la marca `ANULADO` con autor, fecha y
   * motivo, y el evento `PAGO_ANULADO` queda en la MISMA transacción que el
   * cambio. Un pago anulado deja de contar como ingreso, pero el rastro sigue.
   */
  describe('H68 · anular un pago', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';
    const pagoId = 'uuid-pago';
    const reservaId = 'uuid-reserva';
    const motivo = 'Cobré la reserva equivocada';

    /** El pago tal como se lee para resolver de qué sede es. */
    function pagoDeLaSede(extra: Record<string, unknown> = {}) {
      return {
        id: pagoId,
        reservaId,
        estadoPago: 'PAGADA',
        monto: 25,
        reserva: { id: reservaId, barberiaId },
        ...extra,
      };
    }

    it('anula con motivo, autor y fecha, y audita PAGO_ANULADO en la misma transacción', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: usuarioId });
      mockPrismaService.pago.findUnique
        // 1.ª lectura: resolver la sede del pago (fuera de la transacción).
        .mockResolvedValueOnce(pagoDeLaSede())
        // 2.ª lectura: juzgar el estado de la fila que se va a escribir.
        .mockResolvedValueOnce(pagoDeLaSede());
      mockPrismaService.pago.update.mockResolvedValue(pagoDeLaSede({ estadoPago: 'ANULADO' }));

      const resultado = await service.anularPago(usuarioId, barberiaId, pagoId, { motivo });

      expect(resultado.estadoPago).toBe('ANULADO');
      expect(mockPrismaService.pago.update).toHaveBeenCalledWith({
        where: { id: pagoId },
        data: {
          estadoPago: 'ANULADO',
          anuladoAt: AHORA_TRAS_EL_INICIO,
          anuladoPor: usuarioId,
          motivoAnulacion: motivo,
          actualizadoAt: AHORA_TRAS_EL_INICIO,
        },
      });
      expect(mockAuditoriaService.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId,
          accion: 'PAGO_ANULADO',
          entidad: 'PAGO',
          entidadId: pagoId,
          contexto: expect.objectContaining({
            reservaId,
            barberiaId,
            motivo,
            monto: 25,
            estadoPrevioPago: 'PAGADA',
            nuevoEstadoPago: 'ANULADO',
          }),
        }),
        // D28: el evento viaja DENTRO de la transacción del cambio.
        mockPrismaService,
      );
    });

    it('409 ESTADO_INVALIDO si el pago ya estaba ANULADO (ni se reescribe ni se audita)', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: usuarioId });
      mockPrismaService.pago.findUnique
        .mockResolvedValueOnce(pagoDeLaSede({ estadoPago: 'ANULADO' }))
        .mockResolvedValueOnce(pagoDeLaSede({ estadoPago: 'ANULADO' }));

      await expect(
        service.anularPago(usuarioId, barberiaId, pagoId, { motivo }),
      ).rejects.toMatchObject({
        response: { statusCode: 409, codigo: 'ESTADO_INVALIDO' },
      });

      expect(mockPrismaService.pago.update).not.toHaveBeenCalled();
      expect(mockAuditoriaService.registrarEvento).not.toHaveBeenCalled();
    });

    it('409 ESTADO_INVALIDO si el pago nunca se cobró: no hay nada que anular', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: usuarioId });
      mockPrismaService.pago.findUnique
        .mockResolvedValueOnce(pagoDeLaSede({ estadoPago: 'PENDIENTE_DE_PAGO' }))
        .mockResolvedValueOnce(pagoDeLaSede({ estadoPago: 'PENDIENTE_DE_PAGO' }));

      await expect(
        service.anularPago(usuarioId, barberiaId, pagoId, { motivo }),
      ).rejects.toMatchObject({
        response: { statusCode: 409, codigo: 'ESTADO_INVALIDO' },
      });

      expect(mockPrismaService.pago.update).not.toHaveBeenCalled();
    });

    it('422 MOTIVO_REQUERIDO si el motivo solo tiene espacios', async () => {
      await expect(
        service.anularPago(usuarioId, barberiaId, pagoId, { motivo: '   ' }),
      ).rejects.toMatchObject({
        response: { statusCode: 422, codigo: 'MOTIVO_REQUERIDO' },
      });

      // Se rechaza antes de tocar la base: no hay lectura previa ni transacción.
      expect(mockPrismaService.pago.findUnique).not.toHaveBeenCalled();
    });

    it('404 si el pago no existe', async () => {
      mockPrismaService.pago.findUnique.mockResolvedValue(null);

      await expect(
        service.anularPago(usuarioId, barberiaId, pagoId, { motivo }),
      ).rejects.toThrowError(NotFoundException);
    });

    it('404 si el pago es de OTRA sede que la del parámetro (no se filtra la sede ajena)', async () => {
      mockPrismaService.pago.findUnique.mockResolvedValue(
        pagoDeLaSede({ reserva: { id: reservaId, barberiaId: 'uuid-otra-sede' } }),
      );

      await expect(
        service.anularPago(usuarioId, barberiaId, pagoId, { motivo }),
      ).rejects.toThrowError(NotFoundException);

      expect(mockPrismaService.pago.update).not.toHaveBeenCalled();
    });

    it('403 si quien anula no tiene vínculo con la sede', async () => {
      mockPrismaService.pago.findUnique.mockResolvedValue(pagoDeLaSede());
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: 'otro-usuario' });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([]);

      await expect(
        service.anularPago('usuario-ajeno', barberiaId, pagoId, { motivo }),
      ).rejects.toThrowError(ForbiddenException);

      expect(mockPrismaService.pago.update).not.toHaveBeenCalled();
    });

    it('403 si es un BARBERO de la sede: cobrar es suyo, anular el cobro no', async () => {
      mockPrismaService.pago.findUnique.mockResolvedValue(pagoDeLaSede());
      mockPrismaService.barberia.findUnique.mockResolvedValue({
        responsableId: 'uuid-otro-usuario',
      });
      mockPrismaService.usuarioRol.findFirst.mockResolvedValue(null);
      mockPrismaService.usuarioRol.findMany.mockResolvedValue([
        { rol: { nombre: 'BARBERO' } },
      ]);

      await expect(
        service.anularPago('uuid-barbero', barberiaId, pagoId, { motivo }),
      ).rejects.toMatchObject({
        response: { statusCode: 403, codigo: 'ANULACION_SOLO_ADMIN' },
      });

      expect(mockPrismaService.pago.update).not.toHaveBeenCalled();
    });
  });

  /**
   * H68 · el historial de cobros de la sede sale de la tabla `pagos`, no del
   * registro de auditoría: el recibo necesita el ESTADO VIVO (incluido `ANULADO`) y
   * el id de la fila para poder anularla. La auditoría sigue siendo el rastro
   * inmutable (7.1), pero no es el listado.
   */
  describe('H68 · historial de pagos de la sede', () => {
    const usuarioId = 'uuid-responsable';
    const barberiaId = 'uuid-barberia';
    const usuario = {
      id: usuarioId,
      correo: 'responsable@test.com',
      roles: ['ADMIN_BARBERIA'],
      rolesDetallados: [{ nombre: 'ADMIN_BARBERIA', barberiaId, ambito: 'BARBERIA' }],
    };

    function filaDePago(extra: Record<string, unknown> = {}) {
      return {
        id: 'uuid-pago',
        reservaId: 'uuid-reserva',
        estadoPago: 'PAGADA',
        monto: 25.5,
        metodoPago: 'EFECTIVO',
        registradoAt: new Date('2026-10-10T14:30:00.000Z'),
        // Nombres de RELACIÓN de Prisma (`include`), no de columna.
        registrador: {
          id: usuarioId,
          nombreCompleto: 'Rita Responsable',
          correo: 'rita@test.com',
        },
        anuladoAt: null,
        anulador: null,
        motivoAnulacion: null,
        reserva: {
          id: 'uuid-reserva',
          estado: 'COMPLETADA',
          fechaCita: CITA_FECHA,
          horaInicio: CITA_HORA,
          horaFin: new Date('1970-01-01T09:30:00.000Z'),
          cliente: { id: 'uuid-cliente', nombreCompleto: 'Carla Cliente' },
          // H76: el nombre de la RELACIÓN de Prisma es `participanteServicios`
          // (schema.prisma). Con `servicios` Prisma rechaza la consulta entera y
          // el endpoint responde 400: el mock tiene que copiar el esquema real,
          // no la forma que el test imaginaba.
          participantes: [
            {
              participanteServicios: [
                { precioHistorico: 20, servicio: { nombre: 'Corte' } },
                { precioHistorico: 5, servicio: { nombre: 'Barba' } },
              ],
            },
          ],
        },
        ...extra,
      };
    }

    it('devuelve el recibo con el estado VIVO del pago y el detalle de la cita', async () => {
      mockPrismaService.barberia.findUnique.mockResolvedValue({ responsableId: usuarioId });
      mockPrismaService.pago.count.mockResolvedValue(1);
      mockPrismaService.pago.findMany.mockResolvedValue([
        filaDePago({
          estadoPago: 'ANULADO',
          anuladoAt: new Date('2026-10-10T15:00:00.000Z'),
          anulador: {
            id: usuarioId,
            nombreCompleto: 'Rita Responsable',
            correo: 'rita@test.com',
          },
          motivoAnulacion: 'Cobro duplicado',
        }),
      ]);

      const pagina = await service.listarHistorial(usuario, barberiaId, 1, 50);

      expect(pagina).toMatchObject({ total: 1, page: 1, pageSize: 50 });
      expect(pagina.data).toHaveLength(1);
      expect(pagina.data[0]).toMatchObject({
        id: 'uuid-pago',
        reservaId: 'uuid-reserva',
        estadoPago: 'ANULADO',
        monto: 25.5,
        metodoPago: 'EFECTIVO',
        motivoAnulacion: 'Cobro duplicado',
        registradoPor: { nombreCompleto: 'Rita Responsable' },
        anuladoPor: { nombreCompleto: 'Rita Responsable' },
        cliente: { nombreCompleto: 'Carla Cliente' },
        // El precio es el HISTÓRICO del servicio, no el del catálogo de hoy.
        servicios: [
          { nombre: 'Corte', precio: 20 },
          { nombre: 'Barba', precio: 5 },
        ],
        // La cita se lee como etiquetas locales de la sede (E2-04).
        cita: { fecha: '2026-10-10', horaInicio: '09:00', horaFin: '09:30' },
      });
      expect(pagina.data[0].registradoAt).toBe('2026-10-10T14:30:00.000Z');

      // El aislamiento por sede (E1-02) va en la CONSULTA, no en memoria.
      expect(mockPrismaService.pago.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reserva: { barberiaId } },
          orderBy: { registradoAt: 'desc' },
          take: 50,
          skip: 0,
        }),
      );
    });

    it('400 sin barbería y sin ser ADMINISTRADOR, igual que la auditoría de cobros', async () => {
      const cliente: any = {
        id: 'uuid-cliente',
        correo: 'cliente@test.com',
        roles: ['CLIENTE'],
        rolesDetallados: [],
      };

      await expect(service.listarHistorial(cliente, null, 1, 50)).rejects.toThrowError(
        BadRequestException,
      );

      expect(mockPrismaService.pago.findMany).not.toHaveBeenCalled();
    });
  });
});
