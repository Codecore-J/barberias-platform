import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificacionesModule } from './notificaciones.module.js';
import { SharedModule } from '../../shared/shared.module.js';
import { EMAIL_PROVIDER } from '../domain/port/email.provider.js';
import { WHATSAPP_PROVIDER } from '../domain/port/whatsapp.provider.js';
import { ResendEmailProvider } from './resend-email.provider.js';
import { MockEmailProvider } from './mock-email.provider.js';
import { HttpWhatsAppProvider } from './http-whatsapp.provider.js';
import { MockWhatsAppProvider } from './mock-whatsapp.provider.js';

/**
 * Fase 7 · selección de adaptadores en el arranque.
 *
 * Cada caso monta el módulo real con un entorno distinto y comprueba QUÉ
 * instancia queda detrás del token: es la prueba de que el `useFactory` decide
 * bien y de que una baja de credenciales no rompe el arranque (cae en Mock).
 */
describe('NotificacionesModule · useFactory de adaptadores (Fase 7)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function montar() {
    const moduleRef = await Test.createTestingModule({
      // El bus es infraestructura de `AppModule`; aquí se registra igual para
      // poder montar el módulo aislado (el cron inyecta `EventEmitter2`).
      imports: [EventEmitterModule.forRoot(), SharedModule, NotificacionesModule],
    }).compile();

    return {
      email: moduleRef.get(EMAIL_PROVIDER),
      whatsapp: moduleRef.get(WHATSAPP_PROVIDER),
      cerrar: () => moduleRef.close(),
    };
  }

  it('sin credenciales, ambos adaptadores son Mock', async () => {
    vi.unstubAllEnvs();
    delete process.env.RESEND_API_KEY;
    delete process.env.WHATSAPP_API_URL;
    delete process.env.WHATSAPP_API_TOKEN;

    const { email, whatsapp, cerrar } = await montar();

    expect(email).toBeInstanceOf(MockEmailProvider);
    expect(whatsapp).toBeInstanceOf(MockWhatsAppProvider);

    await cerrar();
  });

  it('con RESEND_API_KEY se inyecta ResendEmailProvider', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc123');
    vi.stubEnv('EMAIL_FROM', 'Barberias <no-reply@barberias.com>');
    delete process.env.WHATSAPP_API_URL;
    delete process.env.WHATSAPP_API_TOKEN;

    const { email, whatsapp, cerrar } = await montar();

    expect(email).toBeInstanceOf(ResendEmailProvider);
    // El canal de WhatsApp no tiene credenciales, sigue en Mock.
    expect(whatsapp).toBeInstanceOf(MockWhatsAppProvider);

    await cerrar();
  });

  it('con WHATSAPP_API_URL y WHATSAPP_API_TOKEN se inyecta HttpWhatsAppProvider', async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv('WHATSAPP_API_URL', 'https://graph.facebook.com/v20.0/123/messages');
    vi.stubEnv('WHATSAPP_API_TOKEN', 'EAAG-token');

    const { email, whatsapp, cerrar } = await montar();

    expect(email).toBeInstanceOf(MockEmailProvider);
    expect(whatsapp).toBeInstanceOf(HttpWhatsAppProvider);

    await cerrar();
  });

  it('una sola variable de WhatsApp no basta: se queda en Mock', async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv('WHATSAPP_API_URL', 'https://graph.facebook.com/v20.0/123/messages');
    delete process.env.WHATSAPP_API_TOKEN;

    const { whatsapp, cerrar } = await montar();

    expect(whatsapp).toBeInstanceOf(MockWhatsAppProvider);

    await cerrar();
  });
});