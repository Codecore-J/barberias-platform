import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PagosService } from './pagos.service';
import { TenantService } from './tenant.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * H68 · §7.3: el recibo de la sede y su corrección.
 *
 * Estas pruebas fijan el contrato con el backend que la pantalla necesita:
 *
 *  - el historial sale de `/shops/:shopId/payments/history` (estado VIVO + id del
 *    pago) y no del rastro de auditoría, porque sin el id no se puede anular y sin
 *    el estado no se puede pintar una anulación;
 *  - un 422 del backend deja su `mensaje` en `error()` para que la tabla lo muestre;
 *  - la anulación manda el motivo en el cuerpo: sin él el backend responde 422 y
 *    el cobro no se corrige.
 */
describe('PagosService · historial y anulación de cobros (H68)', () => {
  let service: PagosService;
  let http: HttpTestingController;

  const SEDE = 'b1';
  const HISTORIAL_URL = `${API_URL}/shops/${SEDE}/payments/history`;
  const ANULAR_URL = (id: string) => `${API_URL}/shops/${SEDE}/payments/${id}/void`;

  const cobro = {
    id: 'pago-1',
    reservaId: 'reserva-1',
    estadoPago: 'PAGADA',
    estadoReserva: 'COMPLETADA',
    monto: 25.5,
    metodoPago: 'EFECTIVO',
    registradoAt: '2026-10-10T14:30:00.000Z',
    registradoPor: { id: 'u1', nombreCompleto: 'Rita Responsable', correo: 'rita@test.com' },
    anuladoAt: null,
    anuladoPor: null,
    motivoAnulacion: null,
    cita: { fecha: '2026-10-10', horaInicio: '09:00', horaFin: '09:30' },
    cliente: { id: 'c1', nombreCompleto: 'Carla Cliente' },
    servicios: [{ nombre: 'Corte', precio: 25.5 }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PagosService,
        provideHttpClient(),
        provideHttpClientTesting(),
        // Fase 5: la sede sale de la ruta, así que el servicio la lee del tenant.
        { provide: TenantService, useValue: { barberiaActivaId: () => SEDE } },
      ],
    });

    service = TestBed.inject(PagosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('pide el historial a /shops/:shopId/payments/history y guarda las filas de `data`', () => {
    let recibidos: unknown[] = [];

    service.obtenerHistorial().subscribe((pagos) => (recibidos = pagos));

    const peticion = http.expectOne(`${HISTORIAL_URL}?page=1&pageSize=50`);
    expect(peticion.request.method).toBe('GET');
    peticion.flush({ data: [cobro], total: 1, page: 1, pageSize: 50 });

    expect(recibidos).toHaveLength(1);
    expect(service.pagos()[0].id).toBe('pago-1');
    expect(service.pagos()[0].estadoPago).toBe('PAGADA');
    expect(service.isLoading()).toBe(false);
  });

  it('un 422 del backend deja su `mensaje` en `error()` y no rompe la lista', () => {
    let recibidos: unknown[] = [];

    service.obtenerHistorial().subscribe((pagos) => (recibidos = pagos));

    http.expectOne(`${HISTORIAL_URL}?page=1&pageSize=50`).flush(
      { statusCode: 422, codigo: 'SIN_SEDE', mensaje: 'Debes indicar la barbería.' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(recibidos).toEqual([]);
    expect(service.error()).toBe('Debes indicar la barbería.');
    expect(service.isLoading()).toBe(false);
  });

  it('anula un cobro mandando el motivo en el cuerpo', () => {
    let respuesta: unknown;

    service
      .anularPago('pago-1', 'Cobré la reserva equivocada')
      .subscribe((res) => (respuesta = res));

    const peticion = http.expectOne(ANULAR_URL('pago-1'));
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({ motivo: 'Cobré la reserva equivocada' });
    peticion.flush({ id: 'pago-1', estadoPago: 'ANULADO' });

    expect(respuesta).toMatchObject({ estadoPago: 'ANULADO' });
  });

  it('propaga el error de la anulación para que la pantalla lo muestre', () => {
    let codigo: number | undefined;

    service.anularPago('pago-1', 'motivo cualquiera').subscribe({
      error: (err) => (codigo = err.status),
    });

    http.expectOne(ANULAR_URL('pago-1')).flush(
      {
        statusCode: 409,
        codigo: 'ESTADO_INVALIDO',
        mensaje: 'Este cobro ya está anulado: la anulación no se repite.',
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(codigo).toBe(409);
  });
});
