import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ListaEsperaService } from './lista-espera.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';

/**
 * E4-02 · D22 · Carril B: reglas del alta de una suscripción.
 *
 * Cada `it` fija una regla del contrato, no la forma del mock:
 * la sede existe, los servicios son de ESA sede, y una sola suscripción viva
 * por cliente/sede/fecha.
 */
describe('ListaEsperaService · suscribirse (E4-02 · D22)', () => {
  let service: ListaEsperaService;
  let prisma: {
    barberia: { findUnique: ReturnType<typeof vi.fn> };
    servicio: { findMany: ReturnType<typeof vi.fn> };
    listaEspera: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };

  const AHORA = new Date('2026-10-20T12:00:00.000Z');
  const USUARIO_ID = '11111111-1111-4111-8111-111111111111';
  const BARBERIA_ID = '22222222-2222-4222-8222-222222222222';
  const CORTE_ID = '33333333-3333-4333-8333-333333333333';
  const BARBA_ID = '44444444-4444-4444-8444-444444444444';

  const dto = {
    barberiaId: BARBERIA_ID,
    fechaObjetivo: '2026-10-25',
    servicios: [CORTE_ID, BARBA_ID],
  };

  const suscripcionCreada = {
    id: 'suscripcion-1',
    barberiaId: BARBERIA_ID,
    fechaObjetivo: new Date('2026-10-25T00:00:00.000Z'),
    estado: 'PENDIENTE',
    creadoAt: AHORA,
    servicios: [
      { id: CORTE_ID, nombre: 'Corte' },
      { id: BARBA_ID, nombre: 'Barba' },
    ],
  };

  beforeEach(() => {
    prisma = {
      barberia: {
        findUnique: vi.fn().mockResolvedValue({ id: BARBERIA_ID }),
      },
      servicio: {
        findMany: vi.fn().mockResolvedValue([{ id: CORTE_ID }, { id: BARBA_ID }]),
      },
      listaEspera: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(suscripcionCreada),
      },
    };

    service = new ListaEsperaService(
      prisma as unknown as ConstructorParameters<typeof ListaEsperaService>[0],
      new TiempoService(() => AHORA),
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('REGLA 1 · exige que la barbería exista y responde 404 si no', async () => {
    prisma.barberia.findUnique.mockResolvedValue(null);

    await expect(service.suscribirse(USUARIO_ID, dto)).rejects.toThrow(NotFoundException);

    // Sin sede no se valida nada más ni se escribe.
    expect(prisma.servicio.findMany).not.toHaveBeenCalled();
    expect(prisma.listaEspera.findFirst).not.toHaveBeenCalled();
    expect(prisma.listaEspera.create).not.toHaveBeenCalled();
  });

  it('REGLA 2 · valida los servicios CONTRA LA SEDE, no solo que existan', async () => {
    await service.suscribirse(USUARIO_ID, dto);

    expect(prisma.servicio.findMany).toHaveBeenCalledWith({
      where: { id: { in: dto.servicios }, barberiaId: BARBERIA_ID },
      select: { id: true },
    });
  });

  it('REGLA 2 · 400 SERVICIOS_INVALIDOS si algún servicio es de otra sede', async () => {
    // La sede solo conoce el corte: la barba es de otra barbería.
    prisma.servicio.findMany.mockResolvedValue([{ id: CORTE_ID }]);

    const error = await service.suscribirse(USUARIO_ID, dto).catch((e) => e);

    expect(error.status).toBe(400);
    expect(error.response.statusCode).toBe(400);
    expect(error.response.codigo).toBe('SERVICIOS_INVALIDOS');
    expect(error.response.mensaje).toContain(BARBA_ID);
    expect(prisma.listaEspera.create).not.toHaveBeenCalled();
  });

  it('REGLA 3 · 409 SUSCRIPCION_DUPLICADA si ya hay una PENDIENTE para esa sede y fecha', async () => {
    prisma.listaEspera.findFirst.mockResolvedValue({ id: 'ya-existe' });

    const error = await service.suscribirse(USUARIO_ID, dto).catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.response.codigo).toBe('SUSCRIPCION_DUPLICADA');
    expect(prisma.listaEspera.create).not.toHaveBeenCalled();
  });

  it('REGLA 3 · el duplicado se busca por cliente + sede + fecha y SOLO en PENDIENTE', async () => {
    await service.suscribirse(USUARIO_ID, dto);

    expect(prisma.listaEspera.findFirst).toHaveBeenCalledWith({
      where: {
        usuarioId: USUARIO_ID,
        barberiaId: BARBERIA_ID,
        fechaObjetivo: new Date('2026-10-25T00:00:00.000Z'),
        estado: 'PENDIENTE',
      },
      select: { id: true },
    });
  });

  it('REGLA 3 · una suscripción CERRADA no bloquea volver a anotarse', async () => {
    // El filtro `estado: 'PENDIENTE'` es el que hace que la cerrada no aparezca.
    prisma.listaEspera.findFirst.mockResolvedValue(null);

    const resultado = await service.suscribirse(USUARIO_ID, dto);

    expect(prisma.listaEspera.create).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual(suscripcionCreada);
  });

  it('crea la suscripción en PENDIENTE, con los servicios conectados y el usuario del token', async () => {
    const resultado = await service.suscribirse(USUARIO_ID, dto);

    expect(prisma.listaEspera.create).toHaveBeenCalledWith({
      data: {
        usuarioId: USUARIO_ID,
        barberiaId: BARBERIA_ID,
        // DATE: la etiqueta `YYYY-MM-DD` anclada a la medianoche UTC.
        fechaObjetivo: new Date('2026-10-25T00:00:00.000Z'),
        estado: 'PENDIENTE',
        servicios: { connect: [{ id: CORTE_ID }, { id: BARBA_ID }] },
      },
      select: expect.objectContaining({
        id: true,
        estado: true,
        servicios: { select: { id: true, nombre: true } },
      }),
    });
    expect(resultado).toEqual(suscripcionCreada);
  });

  it('compone la fecha como ETIQUETA de la sede, sin corrimiento por zona del servidor', async () => {
    // Aunque llegue con hora, el DATE se queda con el día: es una etiqueta.
    await service.suscribirse(USUARIO_ID, {
      ...dto,
      fechaObjetivo: '2026-10-25T00:00:00.000Z',
    });

    const { data } = prisma.listaEspera.create.mock.calls[0][0];
    expect(data.fechaObjetivo.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(data.fechaObjetivo.getTime()).toBe(Date.UTC(2026, 9, 25));
  });
});
