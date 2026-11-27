import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { CrearBarberiaComponent } from './crear-barberia.component';
import { TenantService } from '../../core/services/tenant.service';

/**
 * F6 / T-63 · el formulario de alta no crea una sede sin ubicación.
 *
 * Lo que fija esta prueba:
 *  1. Sin coordenadas, «Crear Barbería» está DESHABILITADO y dice
 *     «Confirma tu ubicación primero»: el usuario no puede llegar al backend
 *     para que este le conteste 422.
 *  2. «Usar mi ubicación» pide la posición al navegador; si el permiso se
 *     deniega, el mensaje es el que pide la fase (y no un error genérico).
 *  3. Mientras la posición llega, el botón de ubicación está ocupado (spinner).
 *  4. Con coordenadas se muestran en solo lectura y el alta se habilita.
 *  5. El payload envía `latitud` y `longitud` y NINGUNA división: la provincia y
 *     el municipio los deduce el backend con Nominatim, y si no los devuelve la
 *     sede queda con NULL (T-66, corregido: el cliente no es fuente de respaldo).
 *  6. El campo de logo por URL ya no existe: el logo se sube después (T-64).
 *
 * El navegador nunca se toca de verdad: `navigator.geolocation` es un doble.
 */

const COORDS = { latitude: 18.4861, longitude: -69.9312 };

/**
 * F6 / T-66 · lo que el backend deduce de las coordenadas. El formulario lo
 * pinta en los selects como CONFIRMACIÓN; el usuario puede corregirlo, pero lo
 * corregido no viaja al alta: la sede se crea con lo que verificó el proveedor.
 */
/** Catálogo público tal como lo sirve `GET /divisiones/DO`. */
const CATALOGO = {
  paisCodigo: 'DO',
  provincias: [
    {
      id: 'p-santiago',
      nombre: 'Santiago',
      municipios: [
        { id: 'm-santiago', nombre: 'Santiago de los Caballeros' },
        { id: 'm-tamboril', nombre: 'Tamboril' },
      ],
    },
    {
      id: 'p-dn',
      nombre: 'Distrito Nacional',
      municipios: [{ id: 'm-santo-domingo', nombre: 'Santo Domingo' }],
    },
  ],
};

const UBICACION_DEDUCIDA = {
  paisCodigo: 'DO',
  divisionNivel1: 'Santiago',
  divisionNivel2: 'Tamboril',
  direccionCompleta: 'Tamboril, Santiago, República Dominicana',
};

describe('CrearBarberiaComponent · geolocalización obligatoria (T-63)', () => {
  let geolocation: { getCurrentPosition: ReturnType<typeof vi.fn> };
  let tenant: {
    crearBarberia: ReturnType<typeof vi.fn>;
    cargarDivisiones: ReturnType<typeof vi.fn>;
    resolverUbicacion: ReturnType<typeof vi.fn>;
    error: () => null;
  };

  function montar() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CrearBarberiaComponent],
      providers: [
        // El alta redirige a `/barberias` al terminar: la ruta tiene que existir
        // para que `router.navigate` no deje una promesa rechazada.
        provideRouter([{ path: 'barberias', children: [] }]),
        { provide: TenantService, useValue: tenant },
      ],
    });

    const fixture = TestBed.createComponent(CrearBarberiaComponent);
    fixture.detectChanges();
    return { fixture, componente: fixture.componentInstance };
  }

  const botonCrear = (fixture: any): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;

  const texto = (fixture: any): string => fixture.nativeElement.textContent as string;

  function rellenarFormulario(componente: CrearBarberiaComponent) {
    componente.form.patchValue({
      nombre: 'Barbería Nueva',
      telefono: '8095550000',
      ubicacion: 'Calle 1',
    });
    componente.form.updateValueAndValidity();
  }

  beforeEach(() => {
    geolocation = { getCurrentPosition: vi.fn() };
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });

    tenant = {
      crearBarberia: vi.fn(() => of({ id: 'sede-1' })),
      cargarDivisiones: vi.fn(() => of(CATALOGO)),
      resolverUbicacion: vi.fn(() => of(UBICACION_DEDUCIDA)),
      error: () => null,
    };
    vi.clearAllMocks();
  });

  it('sin coordenadas el alta está deshabilitada y lo dice', () => {
    const { fixture, componente } = montar();
    rellenarFormulario(componente);
    fixture.detectChanges();

    expect(botonCrear(fixture).disabled).toBe(true);
    expect(texto(fixture)).toContain('Confirma tu ubicación primero');
  });

  it('pide la posición al navegador al pulsar «Usar mi ubicación»', () => {
    const { componente } = montar();

    componente.usarMiUbicacion();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('mientras llega la ubicación, el botón de ubicación está ocupado', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation(() => undefined);

    componente.usarMiUbicacion();
    fixture.detectChanges();

    expect(componente.estadoUbicacion()).toBe('obteniendo');
    const botonUbicacion = fixture.nativeElement.querySelector(
      '[data-testid="usar-ubicacion"]',
    ) as HTMLButtonElement;
    expect(botonUbicacion.disabled).toBe(true);
    expect(botonUbicacion.textContent).toContain('Obteniendo');
  });

  it('con la ubicación obtenida habilita el alta y muestra las coordenadas en solo lectura', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation((ok: any) =>
      ok({ coords: COORDS, timestamp: Date.now() }),
    );
    rellenarFormulario(componente);

    componente.usarMiUbicacion();
    fixture.detectChanges();

    expect(componente.coordenadas()).toEqual({
      latitud: COORDS.latitude,
      longitud: COORDS.longitude,
    });
    expect(botonCrear(fixture).disabled).toBe(false);
    // Se muestran en campos de solo lectura: el `value` de un input no aparece
    // en `textContent`, así que se lee del DOM.
    const latitud = fixture.nativeElement.querySelector('#sede-latitud') as HTMLInputElement;
    const longitud = fixture.nativeElement.querySelector('#sede-longitud') as HTMLInputElement;
    expect(latitud.value).toBe('18.4861');
    expect(longitud.value).toBe('-69.9312');
    expect(latitud.readOnly).toBe(true);
    expect(longitud.readOnly).toBe(true);
  });

  it('si el permiso se deniega, muestra el mensaje de la fase', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation((_ok: any, error: any) =>
      error({ code: 1, message: 'User denied Geolocation' }),
    );

    componente.usarMiUbicacion();
    fixture.detectChanges();

    expect(componente.estadoUbicacion()).toBe('denegada');
    expect(texto(fixture)).toContain(
      'Necesitamos tu ubicación para registrar la sede. Activa los permisos de ubicación en tu navegador.',
    );
    expect(botonCrear(fixture).disabled).toBe(true);
  });

  it('envía latitud y longitud, y ninguna división calculada en el navegador', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation((ok: any) =>
      ok({ coords: COORDS, timestamp: Date.now() }),
    );
    rellenarFormulario(componente);
    componente.usarMiUbicacion();
    fixture.detectChanges();

    componente.onSubmit();

    expect(tenant.crearBarberia).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Barbería Nueva',
        telefono: '8095550000',
        ubicacion: 'Calle 1',
        latitud: COORDS.latitude,
        longitud: COORDS.longitude,
      }),
    );
    const enviado = tenant.crearBarberia.mock.calls[0][0];
    expect(enviado).not.toHaveProperty('divisionNivel1');
    expect(enviado).not.toHaveProperty('divisionNivel2');
    expect(enviado).not.toHaveProperty('paisCodigo');
  });

  it('al confirmar la ubicación, prellena provincia y municipio con lo que dedujo el backend', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation((ok: any) =>
      ok({ coords: COORDS, timestamp: Date.now() }),
    );

    componente.usarMiUbicacion();
    fixture.detectChanges();

    expect(tenant.resolverUbicacion).toHaveBeenCalledWith(
      COORDS.latitude,
      COORDS.longitude,
    );
    expect(componente.form.get('provincia')?.value).toBe('Santiago');
    expect(componente.form.get('municipio')?.value).toBe('Tamboril');

    // Y se VEN: los dos selects existen y muestran lo deducido.
    const provincia = fixture.nativeElement.querySelector('#sede-provincia') as HTMLSelectElement;
    const municipio = fixture.nativeElement.querySelector('#sede-municipio') as HTMLSelectElement;
    expect(provincia.value).toBe('Santiago');
    expect(municipio.value).toBe('Tamboril');
    expect(municipio.disabled).toBe(false);
  });

  it('los selects son editables y lo que el usuario cambie no viaja al alta', () => {
    const { fixture, componente } = montar();
    geolocation.getCurrentPosition.mockImplementation((ok: any) =>
      ok({ coords: COORDS, timestamp: Date.now() }),
    );
    rellenarFormulario(componente);
    componente.usarMiUbicacion();
    fixture.detectChanges();

    // El usuario discrepa de la confirmación: los selects se dejan cambiar…
    componente.form.patchValue({ provincia: 'Distrito Nacional', municipio: 'Santo Domingo' });
    fixture.detectChanges();
    expect(componente.form.get('provincia')?.disabled).toBe(false);

    componente.onSubmit();

    // …pero el alta sigue mandando solo lo verificado: el backend ignora estos
    // dos nombres y guarda lo que devolvió Nominatim.
    const enviado = tenant.crearBarberia.mock.calls[0][0];
    expect(enviado).not.toHaveProperty('divisionNivel1');
    expect(enviado).not.toHaveProperty('divisionNivel2');
  });

  it('si la consulta de ubicación falla, el alta sigue sin divisiones', () => {
    const { fixture, componente } = montar();
    tenant.resolverUbicacion.mockReturnValue(throwError(() => new Error('503')));
    geolocation.getCurrentPosition.mockImplementation((ok: any) =>
      ok({ coords: COORDS, timestamp: Date.now() }),
    );
    rellenarFormulario(componente);
    componente.usarMiUbicacion();
    fixture.detectChanges();

    expect(componente.coordenadas()).toEqual({
      latitud: COORDS.latitude,
      longitud: COORDS.longitude,
    });
    expect(componente.form.get('provincia')?.value).toBe('');

    componente.onSubmit();
    const enviado = tenant.crearBarberia.mock.calls[0][0];
    expect(enviado).not.toHaveProperty('divisionNivel1');
  });

  it('el formulario ya no tiene campo de logo por URL', () => {
    const { componente } = montar();

    expect(componente.form.contains('logo')).toBe(false);
    expect(componente.form.contains('logoUrl')).toBe(false);
  });
});
