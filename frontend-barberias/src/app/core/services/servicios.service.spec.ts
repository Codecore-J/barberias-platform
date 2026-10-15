import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ServiciosService } from './servicios.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * E2-07 · P-SD-1/P-SD-2: el panel de administración no puede cablear lo que no
 * recibe. Estas pruebas fijan las dos cosas que la UI necesita del servicio:
 *
 *  - que el catálogo del admin se componga de servicios Y combos, con la forma
 *    que consume la tabla (`esCombo`, `precio`, `duracionMinutos`, `estado`), y
 *  - que un 422 de regla de negocio deje su `mensaje` en `error()` para que la
 *    lista lo muestre en vez de perderse.
 */
describe('ServiciosService · catálogo de administración (E2-07)', () => {
  let service: ServiciosService;
  let http: HttpTestingController;

  const SERVICIOS_URL = `${API_URL}/servicios`;
  const COMBOS_URL = `${API_URL}/catalogo/combos`;

  const servicioCrudo = {
    id: 's1',
    nombre: 'Corte clásico',
    descripcion: 'Tijera y máquina',
    precio: 15,
    duracionEstimada: 30,
    estado: 'ACTIVO',
    barberiaId: 'b1',
  };

  const comboCrudo = {
    id: 'c1',
    nombre: 'Combo Dúo',
    descripcion: null,
    // Prisma serializa los Decimal como string: la tabla espera un número.
    precioEspecial: '25.00',
    duracionPropia: 60,
    estado: 'INACTIVO',
    barberiaId: 'b1',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ServiciosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('la vista de cliente sigue pidiendo solo servicios', () => {
    service.cargarServicios().subscribe();

    http.expectOne(SERVICIOS_URL).flush([servicioCrudo]);
    http.expectNone(COMBOS_URL);

    expect(service.servicios().map((s) => s.id)).toEqual(['s1']);
  });

  it('el catálogo del admin suma los combos y conserva los inactivos', () => {
    service.cargarServicios(true).subscribe();

    http.expectOne(SERVICIOS_URL).flush([servicioCrudo]);
    http.expectOne(COMBOS_URL).flush([comboCrudo]);

    const lista = service.servicios();
    // El catálogo compuesto va ordenado por nombre: «Combo Dúo» antes que «Corte clásico».
    expect(lista.map((s) => s.id)).toEqual(['c1', 's1']);

    const combo = lista.find((s) => s.id === 'c1')!;
    expect(combo.esCombo).toBe(true);
    // Sin el estado INACTIVO en la lista, «Reactivar» sería inalcanzable.
    expect(combo.estado).toBe('INACTIVO');
    expect(combo.precio).toBe(25);
    expect(combo.duracionMinutos).toBe(60);

    const servicio = lista.find((s) => s.id === 's1')!;
    expect(servicio.esCombo).toBe(false);
    expect(servicio.duracionMinutos).toBe(30);
  });

  it('ordena el catálogo compuesto por nombre', () => {
    service.cargarServicios(true).subscribe();

    http.expectOne(SERVICIOS_URL).flush([{ ...servicioCrudo, nombre: 'Zeta' }]);
    http.expectOne(COMBOS_URL).flush([{ ...comboCrudo, nombre: 'Alfa' }]);

    expect(service.servicios().map((s) => s.nombre)).toEqual(['Alfa', 'Zeta']);
  });

  it('si los combos fallan, el admin sigue viendo los servicios', () => {
    service.cargarServicios(true).subscribe();

    http.expectOne(SERVICIOS_URL).flush([servicioCrudo]);
    http
      .expectOne(COMBOS_URL)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(service.servicios().map((s) => s.id)).toEqual(['s1']);
    expect(service.isLoading()).toBe(false);
  });

  it('un 422 de regla de negocio deja su mensaje en error() y no recarga', () => {
    service.desactivarServicio('s1').subscribe({ error: () => undefined });

    const peticion = http.expectOne(`${SERVICIOS_URL}/s1/desactivar`);
    expect(peticion.request.method).toBe('PATCH');
    peticion.flush(
      {
        codigo: 'SERVICIO_EN_COMBO_ACTIVO',
        mensaje: 'El servicio pertenece a 1 combo(s) activo(s): Combo Dúo.',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(service.error()).toBe('El servicio pertenece a 1 combo(s) activo(s): Combo Dúo.');
    http.expectNone(SERVICIOS_URL);
  });

  it('desactivar un servicio recarga el catálogo completo, combos incluidos', () => {
    service.desactivarServicio('s1').subscribe();

    http.expectOne(`${SERVICIOS_URL}/s1/desactivar`).flush({});
    http.expectOne(SERVICIOS_URL).flush([{ ...servicioCrudo, estado: 'INACTIVO' }]);
    http.expectOne(COMBOS_URL).flush([]);

    expect(service.servicios()[0].estado).toBe('INACTIVO');
  });

  it('desactivar un combo llama al endpoint de combos (P-SD-2)', () => {
    service.desactivarCombo('c1').subscribe();

    const peticion = http.expectOne(`${COMBOS_URL}/c1/desactivar`);
    expect(peticion.request.method).toBe('PATCH');
    peticion.flush({});

    http.expectOne(SERVICIOS_URL).flush([]);
    http.expectOne(COMBOS_URL).flush([]);
  });

  it('reactivar un combo también pide el catálogo completo', () => {
    service.reactivarCombo('c1').subscribe();

    const peticion = http.expectOne(`${COMBOS_URL}/c1/reactivar`);
    expect(peticion.request.method).toBe('PATCH');
    peticion.flush({ ...comboCrudo, estado: 'ACTIVO' });

    http.expectOne(SERVICIOS_URL).flush([]);
    http.expectOne(COMBOS_URL).flush([]);
  });
});
