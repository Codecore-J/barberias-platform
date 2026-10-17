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

  it('con otras sedes, la activa pasa a una de la lista y la caché se reescribe', () => {
    localStorage.setItem('active_barberia_id', 'b-fantasma');
    localStorage.setItem('active_barberia_data', JSON.stringify(sede('b-fantasma')));

    service.cargarBarberias().subscribe();
    http.expectOne(RESPONSABILIDAD_URL).flush([sede('b2'), sede('b3')]);

    // No se purga todo al purgar una: queda sede donde operar.
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
      .flush([
        sede('b9', { estadoVinculacion: 'PENDIENTE_APROBACION', esBarberiaActiva: true }),
      ]);

    expect(service.barberiasVinculadas().map((b) => b.id)).toEqual(['b9']);
    expect(service.barberiaActiva()?.id).toBe('b9');
    expect(service.barberiaActiva()?.estadoVinculacion).toBe('PENDIENTE_APROBACION');
  });
});
