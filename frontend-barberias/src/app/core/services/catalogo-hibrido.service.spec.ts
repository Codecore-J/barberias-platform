import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { CatalogoHibridoService } from './catalogo-hibrido.service';
import { TenantService } from './tenant.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * T-25 · editar y desactivar el servicio del barbero, completo.
 *
 * El backend ya acepta descripción (T-23) y foto (T-24), pero el panel no tenía
 * cómo mandarlas: el barbero podía editar nombre, precio y duración, y nada
 * más. Estas pruebas fijan las tres llamadas que faltaban:
 *
 *  - la descripción viaja al crear y al editar;
 *  - la foto se sube como `multipart/form-data` en el campo `archivo`, que es
 *    el que el controlador lee;
 *  - el listado devuelve `descripcion` e `imagenUrl` para pintarlos.
 *
 * En rojo falla porque el servicio no tiene `subirImagenServicio` ni mapea esos
 * campos.
 */
describe('CatalogoHibridoService · descripción y foto del servicio (T-25)', () => {
  let service: CatalogoHibridoService;
  let http: HttpTestingController;

  const SEDE = 'sede-1';
  const SERVICIO = 'servicio-1';
  const MIS_SERVICIOS = `${API_URL}/shops/${SEDE}/mis-servicios`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: TenantService,
          useValue: {
            barberiaActivaId: () => SEDE,
            registrarPurgadorLocal: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(CatalogoHibridoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('manda la descripción al crear el servicio', () => {
    service
      .crearServicio({
        nombre: 'Corte',
        precio: 500,
        duracionMinutos: 30,
        categoriaId: 'cat-1',
        descripcion: 'Con máquina',
      })
      .subscribe();

    const peticion = http.expectOne(MIS_SERVICIOS);
    expect(peticion.request.method).toBe('POST');
    // El alta ya no publica: el backend crea una solicitud ALTA.
    expect(peticion.request.body).toMatchObject({ descripcion: 'Con máquina', tipo: 'ALTA' });
    peticion.flush({ id: SERVICIO });
    http.expectOne(MIS_SERVICIOS).flush([]);
  });

  it('manda la descripción al editar y mantiene el interruptor de activo', () => {
    service
      .actualizarServicio(SERVICIO, { descripcion: '  Otra  ', activo: false })
      .subscribe();

    const peticion = http.expectOne(`${MIS_SERVICIOS}/${SERVICIO}`);
    expect(peticion.request.method).toBe('PATCH');
    expect(peticion.request.body).toEqual({ descripcion: '  Otra  ', activo: false });
    peticion.flush({ id: SERVICIO });
    http.expectOne(MIS_SERVICIOS).flush([]);
  });

  it('sube la foto en multipart con el campo «archivo»', () => {
    const archivo = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });

    service.subirImagenServicio(SERVICIO, archivo).subscribe();

    const peticion = http.expectOne(`${MIS_SERVICIOS}/${SERVICIO}/imagen`);
    expect(peticion.request.method).toBe('PATCH');
    expect(peticion.request.body instanceof FormData).toBe(true);
    expect((peticion.request.body as FormData).get('archivo')).toBeInstanceOf(File);
    peticion.flush({ id: SERVICIO });
    http.expectOne(MIS_SERVICIOS).flush([]);
  });

  it('el listado conserva descripción y URL de la foto', () => {
    let recibidos: unknown;
    service.cargarMisServicios().subscribe((filas) => (recibidos = filas));

    http.expectOne(MIS_SERVICIOS).flush([
      {
        id: SERVICIO,
        categoriaId: 'cat-1',
        barberoId: 'b1',
        nombrePersonalizado: 'Corte',
        descripcion: 'Con máquina',
        imagenUrl: 'https://res.cloudinary.com/demo/image/upload/foto.webp',
        precio: '500',
        duracionMinutos: 30,
        activo: true,
      },
    ]);

    expect(recibidos).toEqual([
      expect.objectContaining({
        descripcion: 'Con máquina',
        imagenUrl: 'https://res.cloudinary.com/demo/image/upload/foto.webp',
      }),
    ]);
  });
});
