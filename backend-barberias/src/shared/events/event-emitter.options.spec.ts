import { describe, expect, it } from 'vitest';
import { EventEmitter2 } from 'eventemitter2';
import { OPCIONES_EVENT_EMITTER } from './event-emitter.options.js';

/**
 * Regresión del bug silencioso: con `wildcard` apagado, `reserva.*` es un nombre
 * literal y ni `AnalyticsCacheListener` ni `NotificacionesListener` se enteraban
 * de `reserva.creada` / `reserva.cancelada`.
 */
describe('OPCIONES_EVENT_EMITTER', () => {
  it('activa wildcard: el patrón reserva.* recibe los eventos reserva.<x>', () => {
    expect(OPCIONES_EVENT_EMITTER.wildcard).toBe(true);

    const emisor = new EventEmitter2({ ...OPCIONES_EVENT_EMITTER });
    const recibidos: string[] = [];
    emisor.on('reserva.*', (evento: unknown) => recibidos.push(String(evento)));

    emisor.emit('reserva.creada', 'creada');
    emisor.emit('reserva.cancelada', 'cancelada');

    expect(recibidos).toEqual(['creada', 'cancelada']);
  });

  it('sin wildcard el mismo patrón NO recibiría nada (por eso está activado)', () => {
    const emisor = new EventEmitter2({ wildcard: false });
    let llamadas = 0;
    emisor.on('reserva.*', () => llamadas++);

    emisor.emit('reserva.cancelada', {});

    expect(llamadas).toBe(0);
  });
});
