import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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
