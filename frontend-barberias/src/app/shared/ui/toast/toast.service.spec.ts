import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from './toast.service';

/**
 * Fase 2 · un mismo evento llegaba por varias suscripciones (interceptor +
 * `catchError` del componente + servicio) y la interfaz apilaba dos o tres
 * toasts idénticos. El servicio es el único punto por el que pasan todos, así
 * que el filtro vive aquí: el aviso visible no se duplica y el gemelo que
 * llega poco después tampoco.
 */
describe('ToastService · Fase 2 · avisos gemelos', () => {
  let toast: ToastService;

  const mensajes = () => toast.toasts().map((t) => t.mensaje);

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no apila un segundo toast idéntico mientras el primero sigue en pantalla', () => {
    toast.error('No tienes permisos para realizar esta acción.', 'Sin permisos de operación');
    toast.error('No tienes permisos para realizar esta acción.', 'Sin permisos de operación');

    expect(toast.toasts().length).toBe(1);
  });

  it('descarta el gemelo que llega dentro de la ventana aunque el primero ya se haya cerrado', () => {
    toast.success('Sede actualizada', 'Sedes');
    toast.descartarTodos();

    // Segunda emisión del mismo evento, ya sin el toast a la vista.
    vi.advanceTimersByTime(500);
    toast.success('Sede actualizada', 'Sedes');
    expect(toast.toasts().length).toBe(0);

    // Pasada la ventana, el mismo texto es un evento NUEVO y vuelve a mostrarse.
    vi.advanceTimersByTime(2000);
    toast.success('Sede actualizada', 'Sedes');
    expect(toast.toasts().length).toBe(1);
  });

  it('no confunde dos mensajes distintos del mismo tipo', () => {
    toast.error('No se pudo guardar');
    toast.error('No se pudo desactivar');

    expect(mensajes()).toEqual(['No se pudo guardar', 'No se pudo desactivar']);
  });
});
