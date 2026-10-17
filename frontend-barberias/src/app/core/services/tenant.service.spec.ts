import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TenantService } from './tenant.service';
import type { BarberiaResumen } from './tenant.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * H74 · la sede activa no puede sobrevivir a su propio vínculo.
 *
 * El caso que motivó la corrección: cuando el cliente se desvinculaba de su
 * ÚLTIMA sede, `cargarBarberias()` recibía una lista vacía y no fijaba nada —la
 * regla anterior solo actuaba al ENCONTRAR una sede—, así que la señal y la
 * caché conservaban la sede cerrada. El usuario seguía en una sede fantasma: la
 * cabecera la anunciaba y `authInterceptor` mandaba su `x-barberia-id` a rutas
 * de una sede a la que ya no pertenecía.
 *
 * Lo que se fija aquí es la regla: la sede activa tiene que estar EN la lista, y
 * la purga alcanza a la señal Y al almacenamiento persistente (los dos, porque
 * `localStorage` es lo que revive la sede al recargar la página).
 *
 * Y (hallazgo 2 de `docs/MATRIZ_RUTAS.md`) la sede no la decide el navegador:
 * toda sede que PASA a ser activa —el auto-pick sin caché, el que sustituye a
 * una purgada, o el botón— pasa antes por `PATCH /barberias/:id/seleccionar`, y
 * el estado local no se toca hasta el 200. Un 403/404 o una caída de red no
 * fijan nada.
 */
describe('TenantService · la sede activa sigue a los vínculos (H74)', () => {
  let service: TenantService;
  let http: HttpTestingController;

  /** El listado por responsabilidad (fila 12 de la matriz) y el del vínculo (H72). */
  const RESPONSABILIDAD_URL = `${API_URL}/barberias`;
  const VINCULO_URL = `${API_URL}/mi-estado/barberias`;

  const sede = (id: string, extra: Partial<BarberiaResumen> = {}): BarberiaResumen => ({
    id,
    nombre: `Sede ${id}`,
    telefono: '8090000000',
    ubicacion: 'Calle 1',
    responsableId: 'responsable-1',
    estado: 'ACTIVO',
    ...extra,
  });

  const activaGuardada = () => localStorage.getItem('active_barberia_id');
  const cacheGuardada = () => localStorage.getItem('active_barberia_data');

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('purga la sede activa (señal y caché) cuando la lista vuelve VACÍA', () => {
    service.setBarberiaActiva(sede('b1'));
    expect(activaGuardada()).toBe('b1');

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([]);
    http.expectOne(VINCULO_URL).flush([]);

    expect(service.barberiasVinculadas()).toEqual([]);
    expect(service.barberiaActiva()).toBeNull();
    // El contexto de la barbería no sobrevive en el almacenamiento persistente.
    expect(activaGuardada()).toBeNull();
    expect(cacheGuardada()).toBeNull();
    expect(service.isLoading()).toBe(false);
  });

  it('conserva la sede activa cuando sigue estando en la lista', () => {
    service.setBarberiaActiva(sede('b1'));

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([sede('b1'), sede('b2')]);

    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
  });

  it('no revive una sede fantasma desde la caché cuando la lista viene vacía', () => {
    // El caso de la RECARGA: al arrancar, el servicio se reconstruye desde
    // `localStorage`, así que la sede cerrada vuelve a ser la activa aunque su
    // vínculo ya no exista. Sin la purga, la cabecera la anuncia otra vez.
    localStorage.setItem('active_barberia_id', 'b-fantasma');
    localStorage.setItem('active_barberia_data', JSON.stringify(sede('b-fantasma')));
    // La caché se lee al CONSTRUIR el servicio, así que hay que rehacer el
    // inyector para reproducir el arranque en frío de verdad.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantService);
    http = TestBed.inject(HttpTestingController);
    expect(service.barberiaActiva()?.id).toBe('b-fantasma');

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([]);
    http.expectOne(VINCULO_URL).flush([]);

    expect(service.barberiaActiva()).toBeNull();
    expect(activaGuardada()).toBeNull();
    expect(cacheGuardada()).toBeNull();
  });

  it('con otras sedes, la sustituta se pide al backend y la caché se reescribe tras el 200', () => {
    localStorage.setItem('active_barberia_id', 'b-fantasma');
    localStorage.setItem('active_barberia_data', JSON.stringify(sede('b-fantasma')));

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([sede('b2'), sede('b3')]);

    // No se purga todo al purgar una: queda sede donde operar. Pero la
    // sustituta ya no la decide el navegador (hallazgo 2): hasta que el
    // backend no acepta el cambio, no hay sede activa.
    expect(service.barberiaActiva()).toBeNull();
    expect(activaGuardada()).toBeNull();

    http.expectOne(`${RESPONSABILIDAD_URL}/b2/seleccionar`).flush({});

    expect(service.barberiaActiva()?.id).toBe('b2');
    expect(activaGuardada()).toBe('b2');
    expect(cacheGuardada()).toContain('b2');
    expect(cacheGuardada()).not.toContain('b-fantasma');
  });

  it('purgarBarberia saca la sede de la lista y limpia la activa si era esa', () => {
    service.setBarberiaActiva(sede('b1'));
    service.barberiasVinculadas.set([sede('b1'), sede('b2')]);

    service.purgarBarberia('b1');

    expect(service.barberiasVinculadas().map((b) => b.id)).toEqual(['b2']);
    expect(service.barberiaActiva()).toBeNull();
    expect(activaGuardada()).toBeNull();
    expect(cacheGuardada()).toBeNull();
  });

  it('purgarBarberia de otra sede NO toca la activa', () => {
    service.setBarberiaActiva(sede('b1'));
    service.barberiasVinculadas.set([sede('b1'), sede('b2')]);

    service.purgarBarberia('b2');

    expect(service.barberiasVinculadas().map((b) => b.id)).toEqual(['b1']);
    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
  });

  it('un fallo de RED no purga nada: la carga que se cae no es una lista vacía', () => {
    service.setBarberiaActiva(sede('b1'));

    service.cargarBarberias().subscribe();
    http
      .expectOne(RESPONSABILIDAD_URL)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBe('boom');
  });

  it('H72: sin sedes por responsabilidad, el cliente recibe las de su vínculo', () => {
    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([]);
    http
      .expectOne(VINCULO_URL)
      .flush([sede('b9', { estadoVinculacion: 'ACTIVO', esBarberiaActiva: true })]);

    // La que el backend marcó activa también confirma el cambio (hallazgo 2).
    http.expectOne(`${RESPONSABILIDAD_URL}/b9/seleccionar`).flush({});

    expect(service.barberiasVinculadas().map((b) => b.id)).toEqual(['b9']);
    expect(service.barberiaActiva()?.id).toBe('b9');
    expect(service.barberiaActiva()?.estadoVinculacion).toBe('ACTIVO');
  });

  it('hallazgo 2: el auto-pick sin caché pide el cambio al backend ANTES de fijar nada', () => {
    // Dispositivo nuevo, o caché acabada de purgar por H74.
    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([sede('b2'), sede('b3')]);

    const peticion = http.expectOne(`${RESPONSABILIDAD_URL}/b2/seleccionar`);
    expect(peticion.request.method).toBe('PATCH');
    // Mientras el backend no conteste no hay sede activa ni caché que escribir.
    expect(service.barberiaActiva()).toBeNull();
    expect(activaGuardada()).toBeNull();
    expect(cacheGuardada()).toBeNull();

    peticion.flush({});

    expect(service.barberiaActiva()?.id).toBe('b2');
    expect(activaGuardada()).toBe('b2');
    expect(cacheGuardada()).toContain('b2');
    expect(service.isLoading()).toBe(false);
  });

  it('hallazgo 2: si el backend rechaza el auto-pick (403), no se fija nada y el error queda visible', () => {
    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([]);
    http
      .expectOne(VINCULO_URL)
      .flush([sede('b9', { estadoVinculacion: 'PENDIENTE_APROBACION', esBarberiaActiva: true })]);

    http
      .expectOne(`${RESPONSABILIDAD_URL}/b9/seleccionar`)
      .flush(
        { message: 'Tu vinculación a esta barbería no está activa.' },
        { status: 403, statusText: 'Forbidden' },
      );

    // La sede PENDIENTE no llega a ser activa: el backend es quien decide.
    expect(service.barberiaActiva()).toBeNull();
    expect(activaGuardada()).toBeNull();
    expect(cacheGuardada()).toBeNull();
    expect(service.error()).toBe('Tu vinculación a esta barbería no está activa.');
    // La lista de sedes no se pierde: solo se rechaza fijar la activa.
    expect(service.barberiasVinculadas().map((b) => b.id)).toEqual(['b9']);
  });

  it('hallazgo 2: la sede de la caché que sigue en la lista no vuelve a pasar por /seleccionar', () => {
    service.setBarberiaActiva(sede('b1'));

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([sede('b1'), sede('b2')]);

    // No hubo cambio de manos: la eligió el usuario y el backend la registró
    // cuando la fijó. Solo se refresca el objeto cacheado.
    http.expectNone(`${RESPONSABILIDAD_URL}/b1/seleccionar`);
    http.expectNone(`${RESPONSABILIDAD_URL}/b2/seleccionar`);
    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
  });

  it('hallazgo 2: el botón solo fija la sede tras el 200 del backend', () => {
    service.barberiasVinculadas.set([sede('b1'), sede('b2')]);
    service.setBarberiaActiva(sede('b1'));
    service.error.set('un error anterior');

    service.seleccionarBarberia('b2').subscribe();

    const peticion = http.expectOne(`${RESPONSABILIDAD_URL}/b2/seleccionar`);
    expect(peticion.request.method).toBe('PATCH');
    // El estado local NO se toca mientras la petición esté en el aire.
    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
    expect(cacheGuardada()).toContain('b1');

    peticion.flush({});

    expect(service.barberiaActiva()?.id).toBe('b2');
    expect(activaGuardada()).toBe('b2');
    expect(cacheGuardada()).toContain('b2');
    // Un intento nuevo borra el error del anterior.
    expect(service.error()).toBeNull();
  });

  it('hallazgo 2: si el PATCH del botón falla, la sede anterior sigue activa y el error se propaga', () => {
    service.barberiasVinculadas.set([sede('b1'), sede('b2')]);
    service.setBarberiaActiva(sede('b1'));

    let fallo: any = null;
    service.seleccionarBarberia('b2').subscribe({ error: (err) => (fallo = err) });

    http
      .expectOne(`${RESPONSABILIDAD_URL}/b2/seleccionar`)
      .flush(
        { message: 'No estás vinculado a esta barbería.' },
        { status: 404, statusText: 'Not Found' },
      );

    expect(fallo).not.toBeNull();
    expect(service.barberiaActiva()?.id).toBe('b1');
    expect(activaGuardada()).toBe('b1');
    expect(cacheGuardada()).toContain('b1');
    expect(service.error()).toBe('No estás vinculado a esta barbería.');
    expect(service.isLoading()).toBe(false);
  });
});
