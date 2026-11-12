import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MiEstadoService } from './mi-estado.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * E4-03/2 · H54 · E3-12/3 · el vínculo propio del cliente en la tarjeta de sede.
 *
 * Fija lo que la pantalla necesita del servicio: que el estado quede indexado por
 * sede, que un 403 `NO_VINCULADO` no se convierta en un error visible (la lista
 * puede traer sedes donde no hay vínculo de cliente), que desvincular olvide el
 * estado de ESA sede —para que la tarjeta deje de ofrecer el botón— y que los
 * errores de regla de negocio (422 `RESERVAS_EN_CURSO`, 409 `ESTADO_INVALIDO`)
 * lleguen con su `mensaje` del contrato D40.
 */
describe('MiEstadoService · el cliente y su vínculo (H54 · E3-12/3)', () => {
  let service: MiEstadoService;
  let http: HttpTestingController;

  const SEDE = 'b1';
  const ESTADO_URL = `${API_URL}/shops/${SEDE}/membership`;
  const DESVINCULAR_URL = `${ESTADO_URL}/unlink`;

  const estadoCrudo = {
    barberiaId: SEDE,
    clienteId: 'c1',
    estadoVinculacion: 'ACTIVO',
    contadorNoPresentado: 3,
    estaRestringido: false,
    motivoRestriccion: null,
    advertencia: true,
    inasistenciasParaRestriccion: 2,
    limiteInasistencias: 5,
    mensaje: 'Estás a 2 inasistencias de ser suspendido en esta barbería.',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MiEstadoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('el estado queda indexado por sede, con el contador y el aviso de la sede', () => {
    service.cargarEstado(SEDE).subscribe();

    http.expectOne(ESTADO_URL).flush(estadoCrudo);

    expect(service.estados()[SEDE]).toMatchObject({
      estadoVinculacion: 'ACTIVO',
      contadorNoPresentado: 3,
      advertencia: true,
    });
    expect(service.error()).toBeNull();
  });

  it('un 403 NO_VINCULADO no es un error de pantalla: se traduce a null', () => {
    let resultado: unknown = 'sin asignar';

    service.cargarEstado(SEDE).subscribe((valor) => (resultado = valor));

    http.expectOne(ESTADO_URL).flush(
      { codigo: 'NO_VINCULADO', mensaje: 'No estás vinculado a esta barbería.' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(resultado).toBeNull();
    expect(service.estados()[SEDE]).toBeUndefined();
    expect(service.error()).toBeNull();
  });

  it('desvincular llama al endpoint nuevo y olvida el estado de esa sede', () => {
    service.cargarEstado(SEDE).subscribe();
    http.expectOne(ESTADO_URL).flush(estadoCrudo);

    let resultado: any;
    service.desvincular(SEDE).subscribe((valor) => (resultado = valor));

    const peticion = http.expectOne(DESVINCULAR_URL);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({});
    peticion.flush({
      barberiaId: SEDE,
      clienteId: 'c1',
      barberiaNombre: 'Barbería Uno',
      estadoVinculacion: 'DESVINCULADO',
      esBarberiaActiva: false,
      vinculacionesVigentes: 4,
    });

    expect(resultado.vinculacionesVigentes).toBe(4);
    expect(service.ultimaDesvinculacion()?.barberiaNombre).toBe('Barbería Uno');
    // La tarjeta ya no puede ofrecer el botón de una sede que se acaba de cerrar.
    expect(service.estados()[SEDE]).toBeUndefined();
    expect(service.isLoading()).toBe(false);
  });

  it('un 422 RESERVAS_EN_CURSO deja su mensaje y NO olvida el vínculo', () => {
    service.cargarEstado(SEDE).subscribe();
    http.expectOne(ESTADO_URL).flush(estadoCrudo);

    service.desvincular(SEDE).subscribe({ error: () => undefined });

    const mensaje =
      'No puedes desvincularte: tienes 1 reserva(s) en curso en esta barbería. Cancélalas o espéralas primero.';
    http.expectOne(DESVINCULAR_URL).flush(
      { codigo: 'RESERVAS_EN_CURSO', mensaje, conteo: 1 },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(service.error()).toBe(mensaje);
    expect(service.estados()[SEDE]).toMatchObject({ estadoVinculacion: 'ACTIVO' });
  });

  it('un 409 ESTADO_INVALIDO (ya estaba cerrado) también se muestra', () => {
    service.desvincular(SEDE).subscribe({ error: () => undefined });

    http.expectOne(DESVINCULAR_URL).flush(
      { codigo: 'ESTADO_INVALIDO', mensaje: 'Tu vínculo con esta barbería ya está cerrado.' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(service.error()).toBe('Tu vínculo con esta barbería ya está cerrado.');
    expect(service.isLoading()).toBe(false);
  });

  it('limpiar() borra el estado: nada de un cliente sobrevive a su sesión', () => {
    service.cargarEstado(SEDE).subscribe();
    http.expectOne(ESTADO_URL).flush(estadoCrudo);

    service.limpiar();

    expect(service.estados()).toEqual({});
    expect(service.ultimaDesvinculacion()).toBeNull();
  });
});

describe('MiEstadoService · membresías en lote (Fase 3)', () => {
  let service: MiEstadoService;
  let http: HttpTestingController;
  const LOTE_URL = `${API_URL}/mi-estado/membresias`;

  const estadoDe = (barberiaId: string, contador: number) => ({
    barberiaId,
    clienteId: 'c1',
    estadoVinculacion: 'ACTIVO',
    contadorNoPresentado: contador,
    estaRestringido: contador >= 5,
    motivoRestriccion: null,
    advertencia: contador >= 3,
    inasistenciasParaRestriccion: 5 - contador,
    limiteInasistencias: 5,
    mensaje: null,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MiEstadoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('una sola petición indexa todas las sedes por su id', () => {
    let recibidos = -1;
    service.cargarEstados().subscribe((estados) => {
      recibidos = estados.length;
    });

    const peticion = http.expectOne(LOTE_URL);
    expect(peticion.request.method).toBe('GET');
    peticion.flush([estadoDe('b1', 0), estadoDe('b2', 4)]);

    expect(recibidos).toBe(2);
    expect(service.estados()['b1'].estadoVinculacion).toBe('ACTIVO');
    expect(service.estados()['b2'].advertencia).toBe(true);
    expect(service.isLoading()).toBe(false);
  });

  it('un fallo del lote no rompe la vista ni ensucia error()', () => {
    let recibidos = -1;
    service.cargarEstados().subscribe((estados) => {
      recibidos = estados.length;
    });

    http.expectOne(LOTE_URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(recibidos).toBe(0);
    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBe(false);
  });
});

describe('MiEstadoService · diagnóstico del lote (Fase 3)', () => {
  let service: MiEstadoService;
  let http: HttpTestingController;
  const LOTE_URL = `${API_URL}/mi-estado/membresias`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MiEstadoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('avisa en desarrollo cuando el backend no sirve el endpoint por lotes', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let recibidos = -1;

    service.cargarEstados().subscribe((estados) => {
      recibidos = estados.length;
    });

    http.expectOne(LOTE_URL).flush({ message: 'Cannot GET' }, { status: 404, statusText: 'Not Found' });

    expect(recibidos).toBe(0);
    expect(aviso).toHaveBeenCalled();
    expect(String(aviso.mock.calls[0][0])).toContain('/mi-estado/membresias');
    aviso.mockRestore();
  });

  it('un 500 no dispara el aviso de endpoint ausente', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});

    service.cargarEstados().subscribe();
    http.expectOne(LOTE_URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});
