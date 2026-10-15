import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VinculacionesService } from './vinculaciones.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * E3-12 · la bandeja de la 6.ª vinculación (D10) desde el panel de plataforma.
 *
 * Fija lo que la pantalla necesita del servicio: que la lista se componga con
 * la forma D32 `{ data, total }`, que resolver recargue la bandeja (si no, la
 * fila aprobada seguiría en pantalla) y que un 422 del contrato D40 deje su
 * `mensaje` en `error()` en vez de perderse.
 */
describe('VinculacionesService · bandeja de plataforma (E3-12)', () => {
  let service: VinculacionesService;
  let http: HttpTestingController;

  const PENDIENTES_URL = `${API_URL}/plataforma/vinculaciones/pendientes`;

  const pendienteCrudo = {
    vinculacionId: 'v1',
    clienteId: 'c1',
    nombreCompleto: 'Cliente Pendiente',
    correo: 'cliente@test.com',
    telefono: '600000001',
    barberiaId: 'b6',
    barberiaNombre: 'Barbería Sexta',
    estadoVinculacion: 'PENDIENTE_APROBACION',
    vinculacionesDelCliente: 6,
    solicitadaAt: '2026-10-15T10:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VinculacionesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista las vinculaciones en espera con su cliente, su sede y el conteo de D10', () => {
    service.cargarPendientes().subscribe();

    http.expectOne((peticion) => peticion.url === PENDIENTES_URL).flush({
      data: [pendienteCrudo],
      total: 1,
    });

    expect(service.pendientes().map((v) => v.vinculacionId)).toEqual(['v1']);
    expect(service.pendientes()[0].vinculacionesDelCliente).toBe(6);
    expect(service.total()).toBe(1);
    expect(service.isLoading()).toBe(false);
  });

  it('pide la página y el tamaño que la pantalla indique', () => {
    service.cargarPendientes(2, 5).subscribe();

    const peticion = http.expectOne(PENDIENTES_URL + '?page=2&pageSize=5');
    expect(peticion.request.method).toBe('GET');
    peticion.flush({ data: [], total: 0 });
  });

  it('sin datos no rompe la tabla: queda vacía y sin total', () => {
    service.cargarPendientes().subscribe();

    http.expectOne((peticion) => peticion.url === PENDIENTES_URL).flush({});

    expect(service.pendientes()).toEqual([]);
    expect(service.total()).toBe(0);
  });

  it('aprobar llama a .../aprobar y recarga la bandeja', () => {
    service.aprobar('v1').subscribe();

    const peticion = http.expectOne(`${API_URL}/plataforma/vinculaciones/v1/aprobar`);
    expect(peticion.request.method).toBe('POST');
    peticion.flush({ vinculacionId: 'v1', estadoVinculacion: 'ACTIVO' });

    // La fila aprobada ya no puede seguir en la lista.
    http.expectOne((peticion) => peticion.url === PENDIENTES_URL).flush({ data: [], total: 0 });

    expect(service.pendientes()).toEqual([]);
  });

  it('rechazar manda el motivo y recarga la bandeja', () => {
    const motivo = 'El cliente ya superó el límite de cinco barberías activas.';

    service.rechazar('v1', motivo).subscribe();

    const peticion = http.expectOne(`${API_URL}/plataforma/vinculaciones/v1/rechazar`);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({ motivo });
    peticion.flush({ vinculacionId: 'v1', estadoVinculacion: 'DESVINCULADO' });

    http.expectOne((peticion) => peticion.url === PENDIENTES_URL).flush({ data: [], total: 0 });
  });

  it('un 422 de regla de negocio deja su mensaje en error()', () => {
    service.rechazar('v1', 'corto').subscribe({ error: () => undefined });

    http.expectOne(`${API_URL}/plataforma/vinculaciones/v1/rechazar`).flush(
      {
        codigo: 'MOTIVO_REQUERIDO',
        mensaje: 'El rechazo exige un motivo de al menos 10 caracteres.',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(service.error()).toBe('El rechazo exige un motivo de al menos 10 caracteres.');
    http.expectNone((peticion) => peticion.url === PENDIENTES_URL);
  });

  it('un 409 al aprobar algo ya resuelto también se muestra', () => {
    service.aprobar('v1').subscribe({ error: () => undefined });

    http.expectOne(`${API_URL}/plataforma/vinculaciones/v1/aprobar`).flush(
      {
        codigo: 'ESTADO_INVALIDO',
        mensaje: 'La vinculación ya está resuelta (ACTIVO).',
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(service.error()).toBe('La vinculación ya está resuelta (ACTIVO).');
  });
});
