import { describe, expect, it, vi } from 'vitest';
import { CrearWalkInYCobrarService } from './crear-walkin-y-cobrar.service.js';
import { EVENTOS_RESERVA } from '../../notificaciones/domain/eventos-reserva.js';

/**
 * Fase 3 · el walk-in cobrado es el único punto del backend donde el alta y el
 * cobro comparten transacción. Lo que estas pruebas defienden no es el formato
 * de la respuesta, sino los dos invariantes que sostienen el «todo o nada»:
 *
 *   1. se abre UNA sola transacción y las dos escrituras reciben el MISMO `tx`;
 *   2. el evento de dominio se publica después del commit, nunca antes —si el
 *      cobro revierte el flujo, no puede haber un aviso de una cita inexistente.
 */
const TX = { marca: 'transaccion-unica' } as any;

const DTO = {
  fecha: '2026-11-02',
  horaInicio: '10:00',
  horaFin: '10:30',
  precioTotalEsperado: 20,
  tipo: 'MANUAL',
} as any;

function montar(opciones: { fallarPago?: boolean; estadoDelAlta?: string } = {}) {
  const prisma = {
    $transaction: vi.fn(async (operacion: any) => operacion(TX)),
  } as any;

  const reservaService = {
    crearReserva: vi.fn().mockResolvedValue({
      id: 'reserva-1',
      estado: opciones.estadoDelAlta ?? 'CONFIRMADA',
    }),
    publicarEventoReserva: vi.fn().mockResolvedValue(undefined),
  } as any;

  const pagoService = {
    registrarPagoEnPersona: opciones.fallarPago
      ? vi.fn().mockRejectedValue(new Error('MONTO_NO_COINCIDE'))
      : vi.fn().mockResolvedValue({
          pago: { id: 'pago-1' },
          reserva: { id: 'reserva-1', estado: 'COMPLETADA' },
        }),
  } as any;

  const servicio = new CrearWalkInYCobrarService(reservaService, pagoService, prisma);
  return { servicio, prisma, reservaService, pagoService };
}

describe('CrearWalkInYCobrarService', () => {
  it('abre UNA transacción y pasa el MISMO tx al alta y al cobro', async () => {
    const { servicio, prisma, reservaService, pagoService } = montar();

    await servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'EFECTIVO');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(reservaService.crearReserva).toHaveBeenCalledWith(
      'usuario-1',
      'barberia-1',
      DTO,
      { tx: TX, confirmarAlCrear: true },
    );
    expect(pagoService.registrarPagoEnPersona).toHaveBeenCalledWith(
      'usuario-1',
      'barberia-1',
      { reservaId: 'reserva-1', metodoPago: 'EFECTIVO' },
      { tx: TX },
    );
  });

  it('la cita nace confirmada: el cobro no depende del temporizador de la sede', async () => {
    const { servicio, reservaService } = montar();

    await servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'TARJETA');

    // `confirmarAlCrear` es lo que hace que una sede en modo MANUAL no deje la
    // cita esperando aceptación con el cliente ya cobrado en el mostrador.
    expect(reservaService.crearReserva.mock.calls[0][3]).toMatchObject({
      confirmarAlCrear: true,
    });
  });

  it('devuelve el recibo con la cita cobrada y su pago', async () => {
    const { servicio } = montar();

    const recibo = await servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'TRANSFERENCIA');

    expect(recibo.reserva.id).toBe('reserva-1');
    expect(recibo.pago.id).toBe('pago-1');
  });

  it('publica el evento SOLO después de que la transacción se confirma', async () => {
    const { servicio, reservaService } = montar();

    await servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'EFECTIVO');

    expect(reservaService.publicarEventoReserva).toHaveBeenCalledWith(
      EVENTOS_RESERVA.CONFIRMADA,
      'reserva-1',
    );
  });

  it('si el cobro falla, propaga el error y NO publica ningún evento', async () => {
    const { servicio, reservaService } = montar({ fallarPago: true });

    await expect(servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'EFECTIVO')).rejects.toThrow(
      'MONTO_NO_COINCIDE',
    );

    // El error sale de dentro del callback de `$transaction`, así que Prisma
    // revierte las dos escrituras; anunciar la cita sería anunciar algo que ya
    // no existe.
    expect(reservaService.publicarEventoReserva).not.toHaveBeenCalled();
  });

  it('revienta si el alta no dejó la cita en un estado cobrable', async () => {
    const { servicio, pagoService, reservaService } = montar({ estadoDelAlta: 'PENDIENTE' });

    // §5.2 fila 11: el STAFF solo cobra desde CONFIRMADA. La comprobación va
    // antes de tocar el dinero y dentro de la transacción, así que un alta que
    // se desviara del contrato no llega a cobrarse nunca.
    await expect(servicio.ejecutar('usuario-1', 'barberia-1', DTO, 'EFECTIVO')).rejects.toThrow();
    expect(pagoService.registrarPagoEnPersona).not.toHaveBeenCalled();
    expect(reservaService.publicarEventoReserva).not.toHaveBeenCalled();
  });
});
