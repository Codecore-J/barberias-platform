import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionesListener } from './notificaciones.listener.js';
import { EMAIL_PROVIDER } from '../domain/port/email.provider.js';
import { WHATSAPP_PROVIDER } from '../domain/port/whatsapp.provider.js';
import {
  EVENTOS_RESERVA,
  type EventoReserva,
  type TipoEventoReserva,
} from '../domain/eventos-reserva.js';

function evento(
  tipo: TipoEventoReserva,
  extra: Partial<EventoReserva> = {},
): EventoReserva {
  return {
    tipo,
    reservaId: 'reserva-1',
    barberiaId: 'barberia-1',
    clienteId: 'cliente-1',
    nombreCliente: 'Ana Pérez',
    correoCliente: 'ana@test.com',
    telefonoCliente: '+18095550000',
    nombreBarberia: 'Sede Centro',
    telefonoBarberia: '+18095551111',
    fechaCita: '2026-10-26',
    horaInicio: '12:30',
    estado: 'CONFIRMADA',
    ...extra,
  };
}

describe('NotificacionesListener (Fase 7)', () => {
  let listener: NotificacionesListener;

  const mockEmail = { enviar: vi.fn() };
  const mockWhatsApp = { enviar: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEmail.enviar.mockResolvedValue(undefined);
    mockWhatsApp.enviar.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificacionesListener,
        { provide: EMAIL_PROVIDER, useValue: mockEmail },
        { provide: WHATSAPP_PROVIDER, useValue: mockWhatsApp },
      ],
    }).compile();

    listener = module.get<NotificacionesListener>(NotificacionesListener);
  });

  it('el recordatorio de 2 horas sale por correo y por WhatsApp', async () => {
    await listener.alOcurrirEventoDeReserva(
      evento(EVENTOS_RESERVA.RECORDATORIO, { horasAntelacion: 2 }),
    );

    expect(mockEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        destinatario: 'ana@test.com',
        asunto: expect.stringContaining('Recordatorio'),
        cuerpo: expect.stringContaining('en 2 horas'),
      }),
    );
    expect(mockWhatsApp.enviar).toHaveBeenCalledWith({
      telefono: '+18095550000',
      texto: expect.stringContaining('Hola Ana Pérez'),
    });
    // La etiqueta de la cita se muestra en formato local, no como ISO.
    expect(mockWhatsApp.enviar).toHaveBeenCalledWith({
      telefono: '+18095550000',
      texto: expect.stringContaining('26/10/2026 a las 12:30'),
    });
  });

  it('una solicitud recién creada solo avisa por correo', async () => {
    await listener.alOcurrirEventoDeReserva(
      evento(EVENTOS_RESERVA.CREADA, { estado: 'PENDIENTE' }),
    );

    expect(mockEmail.enviar).toHaveBeenCalledTimes(1);
    expect(mockEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        cuerpo: expect.stringContaining('pendiente de confirmación'),
      }),
    );
    expect(mockWhatsApp.enviar).not.toHaveBeenCalled();
  });

  it('la confirmación y la cancelación salen por ambos canales', async () => {
    await listener.alOcurrirEventoDeReserva(evento(EVENTOS_RESERVA.CONFIRMADA));
    await listener.alOcurrirEventoDeReserva(evento(EVENTOS_RESERVA.CANCELADA));

    expect(mockEmail.enviar).toHaveBeenCalledTimes(2);
    expect(mockWhatsApp.enviar).toHaveBeenCalledTimes(2);
  });

  it('la inasistencia avisa solo por correo', async () => {
    await listener.alOcurrirEventoDeReserva(
      evento(EVENTOS_RESERVA.INASISTENCIA, { estado: 'NO_PRESENTADO' }),
    );

    expect(mockEmail.enviar).toHaveBeenCalledTimes(1);
    expect(mockEmail.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        cuerpo: expect.stringContaining('no pudiste asistir'),
      }),
    );
    expect(mockWhatsApp.enviar).not.toHaveBeenCalled();
  });

  it('si WhatsApp falla, el correo sale igual y el listener no lanza', async () => {
    mockWhatsApp.enviar.mockRejectedValue(new Error('proveedor caído'));

    await expect(
      listener.alOcurrirEventoDeReserva(evento(EVENTOS_RESERVA.CONFIRMADA)),
    ).resolves.toBeUndefined();

    expect(mockEmail.enviar).toHaveBeenCalledTimes(1);
  });

  it('un evento sin plantilla se ignora sin rechazar la promesa', async () => {
    const desconocido = evento('reserva.reprogramada' as TipoEventoReserva);

    await expect(
      listener.alOcurrirEventoDeReserva(desconocido),
    ).resolves.toBeUndefined();

    expect(mockEmail.enviar).not.toHaveBeenCalled();
    expect(mockWhatsApp.enviar).not.toHaveBeenCalled();
  });
});
