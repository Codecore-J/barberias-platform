import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappWebhookService } from './whatsapp-webhook.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ReservaService } from '../../reserva/application/reserva.service.js';

const RESERVA = {
  id: '6bbb5f07-7546-4fcc-85ea-857e60d60b2e',
  barberiaId: '9f0b0000-0000-4000-8000-000000000001',
  clienteId: '9f0b0000-0000-4000-8000-000000000002',
  estado: 'PENDIENTE',
  cliente: {
    id: '9f0b0000-0000-4000-8000-000000000002',
    nombreCompleto: 'Ana Pérez',
    telefono: '+18095550000',
  },
};

const USUARIO_CLIENTE = {
  id: RESERVA.clienteId,
  correo: 'ana@test.com',
  estadoCuenta: 'ACTIVO',
  usuarioRoles: [
    { barberiaId: null, rol: { nombre: 'CLIENTE', ambito: 'GLOBAL' } },
  ],
};

describe('WhatsappWebhookService (Fase 7)', () => {
  let service: WhatsappWebhookService;

  const mockPrisma = {
    reserva: { findUnique: vi.fn() },
    usuario: { findUnique: vi.fn() },
  };

  const mockReservas = {
    aceptarReserva: vi.fn(),
    cancelarReserva: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrisma.reserva.findUnique.mockResolvedValue(RESERVA);
    mockPrisma.usuario.findUnique.mockResolvedValue(USUARIO_CLIENTE);
    mockReservas.aceptarReserva.mockResolvedValue({ estado: 'CONFIRMADA' });
    mockReservas.cancelarReserva.mockResolvedValue({ estado: 'CANCELADA' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ReservaService, useValue: mockReservas },
      ],
    }).compile();

    service = module.get<WhatsappWebhookService>(WhatsappWebhookService);
  });

  const dto = (extra: Record<string, unknown> = {}) => ({
    reservaId: RESERVA.id,
    telefono: '+18095550000',
    accion: 'CONFIRMAR' as const,
    ...extra,
  });

  it('CONFIRMAR delega en aceptarReserva con la identidad del cliente', async () => {
    const resultado = await service.responder(dto());

    expect(mockReservas.aceptarReserva).toHaveBeenCalledWith(
      RESERVA.barberiaId,
      RESERVA.id,
      expect.objectContaining({
        id: RESERVA.clienteId,
        correo: 'ana@test.com',
        roles: ['CLIENTE'],
        rolesDetallados: [
          { nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' },
        ],
      }),
    );
    expect(resultado).toEqual({
      ok: true,
      accion: 'CONFIRMAR',
      reservaId: RESERVA.id,
      estado: 'CONFIRMADA',
    });
  });

  it('CANCELAR delega en cancelarReserva (ventana, hueco y eventos incluidos)', async () => {
    const resultado = await service.responder(dto({ accion: 'CANCELAR' }));

    expect(mockReservas.cancelarReserva).toHaveBeenCalledWith(
      RESERVA.barberiaId,
      RESERVA.id,
      expect.objectContaining({ id: RESERVA.clienteId }),
    );
    expect(resultado).toMatchObject({ ok: true, estado: 'CANCELADA' });
    expect(mockReservas.aceptarReserva).not.toHaveBeenCalled();
  });

  it('rechaza si el teléfono del payload no es el del cliente (403)', async () => {
    await expect(
      service.responder(dto({ telefono: '+18095551111' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockReservas.aceptarReserva).not.toHaveBeenCalled();
    expect(mockReservas.cancelarReserva).not.toHaveBeenCalled();
  });

  it('acepta el mismo teléfono con otro formato o con prefijo de país', async () => {
    await service.responder(dto({ telefono: '809-555-0000' }));
    expect(mockReservas.aceptarReserva).toHaveBeenCalledTimes(1);

    await service.responder(dto({ telefono: '(809) 555-0000' }));
    expect(mockReservas.aceptarReserva).toHaveBeenCalledTimes(2);
  });

  it('404 cuando la reserva no existe', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue(null);

    await expect(service.responder(dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(mockReservas.aceptarReserva).not.toHaveBeenCalled();
  });

  it('idempotente: CONFIRMAR sobre una CONFIRMADA no reejecuta la transición', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue({ ...RESERVA, estado: 'CONFIRMADA' });

    const resultado = await service.responder(dto());

    expect(resultado).toEqual({
      ok: true,
      accion: 'CONFIRMAR',
      reservaId: RESERVA.id,
      estado: 'CONFIRMADA',
      sinTransicion: true,
    });
    expect(mockReservas.aceptarReserva).not.toHaveBeenCalled();
  });

  it('idempotente: CANCELAR sobre una CANCELADA no reejecuta la transición', async () => {
    mockPrisma.reserva.findUnique.mockResolvedValue({ ...RESERVA, estado: 'CANCELADA' });

    const resultado = await service.responder(dto({ accion: 'CANCELAR' }));

    expect(resultado).toMatchObject({ ok: true, sinTransicion: true });
    expect(mockReservas.cancelarReserva).not.toHaveBeenCalled();
  });

  it('la cuenta suspendida no puede operar por webhook (401)', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue({
      ...USUARIO_CLIENTE,
      estadoCuenta: 'SUSPENDIDO',
    });

    await expect(service.responder(dto())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockReservas.aceptarReserva).not.toHaveBeenCalled();
  });
});