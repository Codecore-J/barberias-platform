import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';
import type { NotificacionItem } from './notification.service';
import { API_URL } from '../constants/api.constants.js';

/**
 * Fase 2b · la campana no puede pedir el listado cada vez que se abre, pero
 * tampoco puede enseñar el de hace media hora: el endpoint SÍ cambia solo
 * (reservas, cobros), así que cachear a ciegas sería mentir.
 *
 * La regla que se fija aquí: una carga por ventana de vigencia, un refresco
 * cuando la ventana se agotó, y ningún sondeo de fondo —el `interval(30 s)` que
 * se eliminó con `notificaciones.service.ts` no vuelve—.
 */
describe('NotificationService · Fase 2b · vigencia del listado', () => {
  let service: NotificationService;
  let http: HttpTestingController;

  const LISTADO_URL = `${API_URL}/notificaciones/mis-notificaciones`;

  const item = (id: string, leido = false): NotificacionItem => ({
    id,
    tipo: 'RESERVA_CREADA',
    titulo: `Aviso ${id}`,
    mensaje: 'Tienes una reserva nueva.',
    leido,
    creadoAt: '2026-11-11T00:00:00.000Z',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('dos aperturas del panel dentro de la ventana comparten UNA sola petición', () => {
    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1')]);

    // Segunda apertura inmediata: el listado sigue vigente.
    service.asegurarCargadas().subscribe();
    http.expectNone(LISTADO_URL);

    expect(service.notificaciones().length).toBe(1);
    expect(service.noLeidasCount()).toBe(1);
  });

  it('pasada la ventana de vigencia, la siguiente apertura SÍ pregunta otra vez', () => {
    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1')]);

    vi.advanceTimersByTime(61_000);

    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1'), item('n2')]);

    expect(service.notificaciones().length).toBe(2);
  });

  it('una carga EXPLÍCITA ignora el umbral (refresco a petición)', () => {
    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1')]);

    service.cargarNotificaciones().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1'), item('n2')]);
  });

  it('un fallo NO fija la vigencia: el siguiente intento vuelve a preguntar', () => {
    service.asegurarCargadas().subscribe();
    http
      .expectOne(LISTADO_URL)
      .flush(
        { statusCode: 500, mensaje: 'Sin conexión con el servicio.' },
        { status: 500, statusText: 'Server Error' },
      );

    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1')]);
  });

  it('dos aperturas simultáneas comparten la petición en vuelo', () => {
    service.asegurarCargadas().subscribe();
    service.asegurarCargadas().subscribe();

    http.expectOne(LISTADO_URL).flush([item('n1')]);

    expect(service.notificaciones().length).toBe(1);
  });

  it('marcar todas como leídas actualiza el contador sin volver a pedir el listado', () => {
    service.asegurarCargadas().subscribe();
    http.expectOne(LISTADO_URL).flush([item('n1'), item('n2')]);
    expect(service.noLeidasCount()).toBe(2);

    service.marcarTodasComoLeidas().subscribe();
    http.expectOne(`${API_URL}/notificaciones/marcar-todas-leidas`).flush({});

    http.expectNone(LISTADO_URL);
    expect(service.noLeidasCount()).toBe(0);
    expect(service.notificaciones().every((n) => n.leido)).toBe(true);
  });
});
