import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipoOtp } from '@prisma/client';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { OtpService } from './otp.service.js';

/**
 * V2.1 · `OtpService`.
 *
 * El servicio solo toca dos cosas —la tabla de códigos y el proveedor del
 * canal—, así que el doble es falso de esas dos piezas y de la transacción que
 * las envuelve.
 */
describe('OtpService', () => {
  const USUARIO_ID = 'usuario-1';
  const TELEFONO = '+18095550199';
  const CORREO = 'audit.cliente@test.com';

  let tx: {
    otpConfirmacion: {
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    usuario: { update: ReturnType<typeof vi.fn> };
  };
  let prisma: { usuario: { findUnique: ReturnType<typeof vi.fn> }; $transaction: ReturnType<typeof vi.fn> };
  let whatsapp: { enviar: ReturnType<typeof vi.fn> };
  let email: { enviar: ReturnType<typeof vi.fn> };
  let service: OtpService;

  const usuarioBase = {
    id: USUARIO_ID,
    correo: CORREO,
    telefono: TELEFONO,
    correoVerificado: false,
    telefonoVerificado: false,
  };

  beforeEach(() => {
    tx = {
      otpConfirmacion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({ id: 'otp-1' }),
      },
      usuario: { update: vi.fn().mockResolvedValue({}) },
    };

    prisma = {
      usuario: { findUnique: vi.fn().mockResolvedValue(usuarioBase) },
      // `withSerializableTransaction` delega en `prisma.$transaction`; aquí se
      // ejecuta el callback con el doble de transacción sin aislamiento real.
      $transaction: vi.fn(async (operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion(tx),
      ),
    };

    whatsapp = { enviar: vi.fn().mockResolvedValue(undefined) };
    email = { enviar: vi.fn().mockResolvedValue(undefined) };

    service = new OtpService(
      prisma as never,
      email as never,
      whatsapp as never,
    );
  });

  describe('enviar', () => {
    it('genera un código de 6 dígitos, invalida los anteriores y entrega por WhatsApp', async () => {
      const resultado = await service.enviar(USUARIO_ID, TipoOtp.TELEFONO);

      expect(whatsapp.enviar).toHaveBeenCalledTimes(1);
      const mensaje = whatsapp.enviar.mock.calls[0][0];
      expect(mensaje.telefono).toBe(TELEFONO);
      expect(mensaje.texto).toMatch(
        /^Tu código de verificación para Imperial Barbers es: \d{6}\. Expira en 10 minutos\.$/,
      );

      // Los códigos vivos del mismo canal se invalidan (marcados, no borrados).
      expect(tx.otpConfirmacion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { usuarioId: USUARIO_ID, tipo: TipoOtp.TELEFONO, usado: false },
          data: expect.objectContaining({ usado: true }),
        }),
      );

      const creado = tx.otpConfirmacion.create.mock.calls[0][0].data;
      expect(creado.codigo).toMatch(/^\d{6}$/);
      expect(creado.tipo).toBe(TipoOtp.TELEFONO);
      expect(new Date(creado.expiraEn).getTime() - Date.now()).toBeCloseTo(10 * 60 * 1000, -3);

      expect(resultado.mensaje).toContain('teléfono');
      expect(Date.parse(resultado.expiraEn)).toBeGreaterThan(Date.now());
    });

    it('con tipo CORREO sale por el proveedor de correo y no por WhatsApp', async () => {
      await service.enviar(USUARIO_ID, TipoOtp.CORREO);

      expect(whatsapp.enviar).not.toHaveBeenCalled();
      expect(email.enviar).toHaveBeenCalledTimes(1);
      expect(email.enviar.mock.calls[0][0]).toMatchObject({
        destinatario: CORREO,
        cuerpo: expect.stringMatching(/^Tu código de verificación para Imperial Barbers es: \d{6}\./),
      });
    });

    it('no envía nada si el canal ya está verificado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...usuarioBase, telefonoVerificado: true });

      await service.enviar(USUARIO_ID, TipoOtp.TELEFONO);

      expect(whatsapp.enviar).not.toHaveBeenCalled();
      expect(tx.otpConfirmacion.create).not.toHaveBeenCalled();
    });

    it('si el proveedor falla responde 503 con el contrato D40, no un 500', async () => {
      whatsapp.enviar.mockRejectedValue(new Error('twilio 502'));

      await expect(service.enviar(USUARIO_ID, TipoOtp.TELEFONO)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ServiceUnavailableException &&
          (error.getResponse() as { codigo: string }).codigo === 'OTP_ENVIO_FALLIDO',
      );
    });
  });

  describe('verificar', () => {
    const datos = { codigo: '004123', tipo: TipoOtp.TELEFONO };

    it('busca SOLO un código vivo del canal (sin usar y dentro de la ventana)', async () => {
      await service.verificar(USUARIO_ID, datos);

      expect(tx.otpConfirmacion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            usuarioId: USUARIO_ID,
            tipo: TipoOtp.TELEFONO,
            codigo: '004123',
            usado: false,
            expiraEn: { gt: expect.any(Date) },
          }),
        }),
      );
    });

    it('al acertar consume el código y levanta la bandera del teléfono', async () => {
      const resultado = await service.verificar(USUARIO_ID, datos);

      expect(tx.otpConfirmacion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'otp-1', usado: false },
          data: expect.objectContaining({ usado: true }),
        }),
      );
      expect(tx.usuario.update).toHaveBeenCalledWith({
        where: { id: USUARIO_ID },
        data: { telefonoVerificado: true },
      });
      expect(resultado).toEqual({ verificado: true, tipo: TipoOtp.TELEFONO });
    });

    it('con un código inexistente, vencido o ya usado responde el mismo 400', async () => {
      tx.otpConfirmacion.findFirst.mockResolvedValue(null);

      await expect(service.verificar(USUARIO_ID, datos)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });

    it('si otra petición consumió el código primero, el ganador único no deja pasar la segunda', async () => {
      // Gana otra carrera: el `updateMany` con `usado: false` ya no encuentra fila.
      tx.otpConfirmacion.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verificar(USUARIO_ID, datos)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.usuario.update).not.toHaveBeenCalled();
    });
  });
});
