import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CatalogoComponent } from './catalogo.component';
import { CatalogoHibridoService } from '../../core/services/catalogo-hibrido.service';
import { ServiciosService } from '../../core/services/servicios.service';
import { TenantService } from '../../core/services/tenant.service';

/**
 * Fase 3 · el catálogo híbrido es la fuente principal y el heredado
 * (`GET /shops/:id/services`) pasó a ser un RESPALDO secuencial. Antes las dos
 * peticiones salían siempre en paralelo y una era de más en cada visita.
 *
 * Se instancia el componente dentro del contexto de inyección (sin renderizar
 * la plantilla) para probar el flujo de carga aislado de la vista.
 */
describe('CatalogoComponent · respaldo secuencial del catálogo', () => {
  const CATEGORIA = {
    id: 'cat-1',
    nombre: 'Cortes',
    servicios: [{ id: 's-1', nombre: 'Corte', precio: 10, duracionMinutos: 30 }],
  } as never;

  let cargarCatalogo: ReturnType<typeof vi.fn>;
  let cargarServicios: ReturnType<typeof vi.fn>;

  function crearComponente(): CatalogoComponent {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CatalogoHibridoService,
          useValue: {
            cargarCatalogo,
            catalogo: signal([]),
            cargandoCatalogo: signal(false),
            errorCatalogo: signal(null),
          },
        },
        {
          provide: ServiciosService,
          useValue: {
            cargarServicios,
            servicios: signal([]),
            isLoading: signal(false),
          },
        },
        {
          provide: TenantService,
          useValue: {
            barberiaActiva: signal(null),
            barberiaActivaId: signal(null),
            tieneBarberiaActiva: signal(false),
          },
        },
      ],
    });

    return TestBed.runInInjectionContext(() => new CatalogoComponent());
  }

  beforeEach(() => {
    cargarCatalogo = vi.fn(() => of([CATEGORIA]));
    cargarServicios = vi.fn(() => of([]));
  });

  it('con catálogo híbrido NO pide el heredado', () => {
    const componente = crearComponente();
    componente.ngOnInit();

    expect(cargarCatalogo).toHaveBeenCalledTimes(1);
    expect(cargarServicios).not.toHaveBeenCalled();
    expect(componente.respaldoListo()).toBe(false);
  });

  it('con el híbrido vacío pide el heredado una sola vez y marca el respaldo', () => {
    cargarCatalogo = vi.fn(() => of([]));
    const componente = crearComponente();
    componente.ngOnInit();

    expect(cargarServicios).toHaveBeenCalledTimes(1);
    expect(componente.respaldoListo()).toBe(true);
  });

  it('si el híbrido falla, cae al heredado', () => {
    cargarCatalogo = vi.fn(() => throwError(() => new Error('500')));
    const componente = crearComponente();
    componente.ngOnInit();

    expect(cargarServicios).toHaveBeenCalledTimes(1);
    expect(componente.respaldoListo()).toBe(true);
  });

  it('el respaldo no queda marcado hasta que responde', () => {
    const pendiente = new Subject<never[]>();
    cargarCatalogo = vi.fn(() => of([]));
    cargarServicios = vi.fn(() => pendiente);

    const componente = crearComponente();
    componente.ngOnInit();

    expect(componente.respaldoListo()).toBe(false);
    pendiente.complete();
    expect(componente.respaldoListo()).toBe(true);
  });
});
