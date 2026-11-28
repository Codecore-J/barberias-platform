import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API_URL } from '../../core/constants/api.constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../auth.service';

/**
 * Fase 3 · el login montaba a la vez el formulario de credenciales y los dos de
 * recuperación (paso 1 y paso 2), dentro de un modal que se ocultaba con
 * `display:none`. Tres formularios vivos en el DOM producían envíos ambiguos,
 * confusión para los gestores de contraseñas y `submit` impredecibles.
 *
 * Aquí se fija el contrato nuevo: un solo `<form>` en el DOM en cada momento,
 * cada uno con su `id`, y el `ngSubmit` del login disparando el servicio.
 *
 * El overlay del modal se porta a `<body>`, así que las aserciones se hacen
 * sobre `document` y no sobre el host del componente.
 */
describe('LoginComponent · un solo formulario activo', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: AuthService;

  const formularios = (): HTMLFormElement[] =>
    Array.from(document.querySelectorAll<HTMLFormElement>('form'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    auth = TestBed.inject(AuthService);
    fixture.detectChanges();
  });

  /** El botón que abre la recuperación (type="button", no envía nada). */
  const abrirRecuperacion = (): void => {
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Olvidaste'));

    if (!boton) throw new Error('No se encontró el botón de recuperación');
    boton.click();
    fixture.detectChanges();
  };

  it('la vista inicial monta únicamente el formulario de credenciales', () => {
    expect(formularios()).toHaveLength(1);

    const login = formularios()[0];
    expect(login.id).toBe('login-form');
    expect(login.querySelector('input[autocomplete="email"]')).not.toBeNull();
    expect(login.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    expect(login.querySelector('button[type="submit"]')).not.toBeNull();
    expect(document.querySelector('#recovery-form')).toBeNull();
    expect(document.querySelector('#recovery-reset-form')).toBeNull();
  });

  it('al abrir la recuperación el login se desmonta y queda solo el de recuperación', () => {
    abrirRecuperacion();

    expect(formularios()).toHaveLength(1);

    const recuperacion = formularios()[0];
    expect(recuperacion.id).toBe('recovery-form');
    expect(recuperacion.querySelector('input[autocomplete="email"]')).not.toBeNull();
    expect(recuperacion.querySelector('button[type="submit"]')).not.toBeNull();
    expect(document.querySelector('#login-form')).toBeNull();
  });

  it('al cerrar la recuperación vuelve a quedar un único formulario: el de login', () => {
    abrirRecuperacion();

    fixture.componentInstance.closeRecoveryModal();
    fixture.detectChanges();

    expect(formularios()).toHaveLength(1);
    expect(formularios()[0].id).toBe('login-form');
    expect(document.querySelector('#recovery-form')).toBeNull();
  });

  it('el envío del formulario principal dispara authService.login', () => {
    const espia = vi.spyOn(auth, 'login').mockReturnValue(EMPTY);

    fixture.componentInstance.loginForm.setValue({
      correo: 'cliente@demo.com',
      password: 'Password123!',
    });
    fixture.detectChanges();

    document
      .querySelector('#login-form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0][0]).toMatchObject({
      correo: 'cliente@demo.com',
      password: 'Password123!',
    });
  });

  it('abrir la recuperación limpia el error del intento de login anterior', () => {
    const limpiar = vi.spyOn(auth, 'limpiarError');

    abrirRecuperacion();

    expect(limpiar).toHaveBeenCalled();
  });

  it('el paso 1 lleva autocomplete de correo y el paso 2, de token y contraseña nueva', () => {
    abrirRecuperacion();
    fixture.componentInstance.goToStep(2);
    fixture.detectChanges();

    expect(formularios()).toHaveLength(1);
    expect(formularios()[0].id).toBe('recovery-reset-form');
    expect(formularios()[0].querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
    expect(formularios()[0].querySelector('input[autocomplete="new-password"]')).not.toBeNull();
  });
});

/**
 * F8 / T-83 · cold start de Render con mensaje explicativo.
 *
 * El plan Free duerme la instancia y la primera petición tarda ~60 s: el
 * formulario se quedaba congelado sin decir nada y el usuario recargaba, lo que
 * reiniciaba la espera. La pantalla sondea `GET /health/liveness` con 3 s de
 * plazo, avisa mientras no responde y bloquea el envío; a los 90 s declara el
 * servidor no disponible.
 *
 * El test monta el componente con temporizadores falsos porque los tres plazos
 * (3 s, reintento y 90 s) son parte del contrato: esperarlos de verdad haría un
 * test de minuto y medio.
 */
describe('LoginComponent · cold start (F8 / T-83)', () => {
  async function montarConTemporizadoresFalsos(): Promise<{
    fixture: ComponentFixture<LoginComponent>;
    http: HttpTestingController;
  }> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('ROJO: el aviso aparece si /liveness tarda más de 3 s y desaparece al responder', async () => {
    vi.useFakeTimers();

    try {
      const { fixture, http } = await montarConTemporizadoresFalsos();
      const componente = fixture.componentInstance;

      // 1 · la sonda sale al montar la pantalla
      const primera = http.expectOne(`${API_URL}/health/liveness`);
      expect(primera.request.method).toBe('GET');

      // 2 · dentro del plazo no hay aviso
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(componente.servidorDespertando()).toBe(false);

      // 3 · pasados 3 s sin respuesta: banner, botón bloqueado
      vi.advanceTimersByTime(2200);
      fixture.detectChanges();

      expect(componente.servidorDespertando()).toBe(true);
      expect(document.body.textContent).toContain(
        'Despertando el servidor, puede tardar hasta 60 segundos. Por favor espera.',
      );

      componente.loginForm.setValue({ correo: 'ana@demo.com', password: 'Password1!' });
      fixture.detectChanges();
      const boton = (fixture.nativeElement as HTMLElement).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(boton.disabled).toBe(true);

      // 4 · la primera sonda nunca responde (Render despertando) y el reintento
      // sí: el aviso se apaga y el botón vuelve.
      void primera;
      vi.advanceTimersByTime(5000);
      http.expectOne(`${API_URL}/health/liveness`).flush({ status: 'ok' });
      fixture.detectChanges();

      expect(componente.servidorDespertando()).toBe(false);
      expect(document.body.textContent).not.toContain('Despertando el servidor');
      expect(boton.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el servidor no responde en 90 s lo dice y deja de sondear', async () => {
    vi.useFakeTimers();

    try {
      const { fixture, http } = await montarConTemporizadoresFalsos();
      const componente = fixture.componentInstance;

      vi.advanceTimersByTime(90_000);
      // Todas las sondas del reintento quedan sin responder: se descartan.
      http.match(`${API_URL}/health/liveness`);
      fixture.detectChanges();

      expect(componente.servidorDespertando()).toBe(false);
      expect(componente.servidorNoDisponible()).toBe(true);
      expect(document.body.textContent).toContain(
        'El servidor no está disponible. Intenta de nuevo en unos minutos.',
      );

      // Y no sigue machacando al backend cada 5 s.
      vi.advanceTimersByTime(20_000);
      expect(http.match(`${API_URL}/health/liveness`)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
