import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotificacionesWebhookController } from './notificaciones-webhook.controller.js';
import { WhatsappWebhookService } from '../application/whatsapp-webhook.service.js';
import { IS_PUBLIC_KEY } from '../../iam/infrastructure/public.decorator.js';

const SECRETO = 'secreto_de_webhook_para_las_pruebas_1234';

const CUERPO_VALIDO = {
  reservaId: '6bbb5f07-7546-4fcc-85ea-857e60d60b2e',
  telefono: '+18095550000',
  accion: 'CONFIRMAR',
};

/**
 * Fase 7 · `POST /webhooks/whatsapp`.
 *
 * La app de prueba lleva el mismo `ValidationPipe` global que `main.ts` para
 * que el contrato del cuerpo sea el que verá el proveedor en producción. La
 * autenticación es solo el secreto: aquí no hay guard JWT porque la ruta es
 * `@Public()`.
 */
describe('POST /webhooks/whatsapp (Fase 7)', () => {
  let app: INestApplication;
  const servicio = { responder: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificacionesWebhookController],
      providers: [{ provide: WhatsappWebhookService, useValue: servicio }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_WEBHOOK_SECRET = SECRETO;
    servicio.responder.mockResolvedValue({
      ok: true,
      accion: 'CONFIRMAR',
      reservaId: CUERPO_VALIDO.reservaId,
      estado: 'CONFIRMADA',
    });
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
  });

  it('está marcada @Public: la ruta no exige JWT', () => {
    const reflector = app.get(Reflector);
    const descriptor = Object.getOwnPropertyDescriptor(
      NotificacionesWebhookController.prototype,
      'recibir',
    );

    expect(descriptor?.value).toBeDefined();
    expect(reflector.get(IS_PUBLIC_KEY, descriptor?.value)).toBe(true);
  });

  it('con el secreto correcto ejecuta la acción y devuelve la reserva', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', SECRETO)
      .send(CUERPO_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, estado: 'CONFIRMADA' });
    expect(servicio.responder).toHaveBeenCalledWith(CUERPO_VALIDO);
  });

  it('con un secreto equivocado responde 401 y no toca la reserva', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', 'otro_secreto')
      .send(CUERPO_VALIDO);

    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('WEBHOOK_SECRETO_INVALIDO');
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it('sin el header del secreto responde 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .send(CUERPO_VALIDO);

    expect(res.status).toBe(401);
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it('si el entorno no define el secreto, el endpoint queda cerrado (503)', async () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;

    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', SECRETO)
      .send(CUERPO_VALIDO);

    expect(res.status).toBe(503);
    expect(res.body.codigo).toBe('WEBHOOK_NO_CONFIGURADO');
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it('valida el cuerpo: una acción fuera de catálogo es 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', SECRETO)
      .send({ ...CUERPO_VALIDO, accion: 'ELIMINAR' });

    expect(res.status).toBe(400);
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it('valida el cuerpo: sin teléfono no se procesa (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', SECRETO)
      .send({ reservaId: CUERPO_VALIDO.reservaId, accion: 'CANCELAR' });

    expect(res.status).toBe(400);
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it('un cuerpo con campos desconocidos se rechaza (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-webhook-secret', SECRETO)
      .send({ ...CUERPO_VALIDO, admin: true });

    expect(res.status).toBe(400);
    expect(servicio.responder).not.toHaveBeenCalled();
  });
});