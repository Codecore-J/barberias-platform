import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { VerifyOtpComponent } from './verify-otp.component';
import { AuthService } from '../auth.service';

/**
 * T-21 · flujo de la «cuenta zombie» en la pantalla de verificación.
 *
 * Lo que se fija aquí es el contrato de estados que el usuario ve: el envío
 * automático con su cuenta regresiva, el formulario de corrección que no envía
 * nada hasta tener 10 dígitos, y —lo más importante— que guardar el número
 * nuevo dispare el reenvío por sí solo. Si esa segunda mitad se rompiera, la
 * UI diría «número actualizado» y no llegaría ningún código: exactamente el
 * bug que T-21 existe para cerrar.
 *
 * `AuthService` se sustituye por un doble porque la pantalla solo usa su API
 * pública; el HTTP real se probaría dos veces y no aportaría nada aquí.
 */
describe('VerifyOtpComponent · cuenta pendiente (T-21)', () => {
  let fixture: ComponentFixture<VerifyOtpComponent>;
  let componente: VerifyOtpComponent;

  const TELEFONO_ACTUAL = '8095550100';
  const TELEFONO_NUEVO = '8495550199';

  let auth: {
    getToken: ReturnType<typeof vi.fn>;
    cargarSesion: ReturnType<typeof vi.fn>;
    sendOtp: ReturnType<typeof vi.fn>;
    resendOtp: ReturnType<typeof vi.fn>;
    updateContact: ReturnType<typeof vi.fn>;
    verifyOtp: ReturnType<typeof vi.fn>;
    authState: () => { user: { telefono: string } };
  };

  beforeEach(async () => {
    auth = {
      getToken: vi.fn().mockReturnValue('token-vivo'),
      cargarSesion: vi.fn().mockReturnValue(
        of({ telefonoVerificado: false, telefono: TELEFONO_ACTUAL }),
      ),
      sendOtp: vi.fn().mockReturnValue(
        of({ mensaje: 'Código enviado a tu teléfono.', expiraEn: new Date().toISOString() }),
      ),
      resendOtp: vi.fn().mockReturnValue(
        of({ mensaje: 'Código enviado a tu teléfono.', expiraEn: new Date().toISOString() }),
      ),
      updateContact: vi.fn().mockReturnValue(
        of({
          mensaje: 'Contacto actualizado.',
          telefono: TELEFONO_NUEVO,
          correo: 'zombie@test.com',
          canalesInvalidados: ['TELEFONO'],
        }),
      ),
      verifyOtp: vi.fn().mockReturnValue(of({ verificado: true, tipo: 'TELEFONO' })),
      authState: () => ({ user: { telefono: TELEFONO_ACTUAL } }),
    };

    await TestBed.configureTestingModule({
      imports: [VerifyOtpComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VerifyOtpComponent);
    componente = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    // El temporizador de 60 s vive en el componente: sin destruirlo, el
    // intervalo sigue corriendo entre pruebas y filtra estado.
    fixture.destroy();
    vi.clearAllTimers();
  });

  const botonPorTexto = (texto: string): HTMLButtonElement => {
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes(texto));

    if (!boton) throw new Error(`No se encontró el botón «${texto}»`);
    return boton as HTMLButtonElement;
  };

  it('al entrar pide el código inicial y arranca la cuenta regresiva', () => {
    expect(auth.sendOtp).toHaveBeenCalledWith('TELEFONO');
    expect(auth.resendOtp).not.toHaveBeenCalled();
    expect(componente.segundosRestantes()).toBeGreaterThan(0);
    // El botón de reenvío queda cerrado mientras corre el temporizador.
    expect(botonPorTexto('Reenviar').disabled).toBe(true);
  });

  it('el enlace de cambio abre el formulario con el número actual y no envía nada', () => {
    botonPorTexto('Cambiar número').click();
    fixture.detectChanges();

    const formulario = (fixture.nativeElement as HTMLElement).querySelector(
      '#cambio-contacto-form',
    ) as HTMLFormElement | null;

    expect(formulario).not.toBeNull();
    expect(componente.contactoForm.get('telefono')?.value).toBe(TELEFONO_ACTUAL);
    expect(auth.updateContact).not.toHaveBeenCalled();
    // Un solo formulario de código sigue en el DOM, el de cambio es otro distinto:
    // nunca se anida un form dentro de otro.
    expect(formulario?.closest('form')).toBe(formulario);
  });

  it('un número incompleto se marca pero no se envía', () => {
    componente.abrirCambio();
    componente.contactoForm.setValue({ telefono: '809555' });
    componente.guardarContacto();

    expect(componente.contactoForm.get('telefono')?.touched).toBe(true);
    expect(auth.updateContact).not.toHaveBeenCalled();
    expect(auth.resendOtp).not.toHaveBeenCalled();
  });

  it('guardar un número válido actualiza el contacto y reenvía el código solo', () => {
    componente.abrirCambio();
    componente.contactoForm.setValue({ telefono: TELEFONO_NUEVO });

    componente.guardarContacto();
    fixture.detectChanges();

    expect(auth.updateContact).toHaveBeenCalledWith({ telefono: TELEFONO_NUEVO });
    // El código del número viejo quedó invalidado en el backend: se pide uno
    // nuevo al destino corregido sin esperar los 60 s del botón.
    expect(auth.resendOtp).toHaveBeenCalledWith('TELEFONO');
    expect(componente.mostrandoCambio()).toBe(false);
    expect(componente.codigoForm.get('codigo')?.value).toBeFalsy();
    expect(componente.aviso()).toContain(TELEFONO_NUEVO);
  });

  it('si el backend rechaza el número, el formulario sigue abierto con el motivo', () => {
    auth.updateContact.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              codigo: 'CONTACTO_EN_USO',
              mensaje: 'Ese teléfono ya está registrado en otra cuenta.',
            },
          }),
      ),
    );

    componente.abrirCambio();
    componente.contactoForm.setValue({ telefono: TELEFONO_NUEVO });
    componente.guardarContacto();
    fixture.detectChanges();

    expect(auth.resendOtp).not.toHaveBeenCalled();
    expect(componente.mostrandoCambio()).toBe(true);
    expect(componente.error()).toBe('Ese teléfono ya está registrado en otra cuenta.');
  });

  it('el botón de reenvío usa el endpoint de reenvío (no el de envío inicial)', () => {
    componente.segundosRestantes.set(0);
    componente.enviar();

    expect(auth.resendOtp).toHaveBeenCalledWith('TELEFONO');
    expect(auth.sendOtp).toHaveBeenCalledTimes(1);
  });
});
