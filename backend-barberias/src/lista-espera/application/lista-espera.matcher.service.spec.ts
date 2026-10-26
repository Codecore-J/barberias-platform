import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListaEsperaMatcherService } from './lista-espera.matcher.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';
import { ESTADOS_LISTA_ESPERA } from '../../shared/domain/estados.js';

/**
 * E4-02 · D22 · Carril B: el matcher de la lista de espera.
 *
 * Las reglas que fija cada `it`:
 *  - un hueco liberado produce como mucho UN aviso;
 *  - el orden es FIFO (`creadoAt asc`), no el que más convenga al negocio;
 *  - «caber» = suma de duraciones + margen de la sede ≤ duración del hueco;
 *  - el aviso se manda solo si el test-and-set (`PENDIENTE → NOTIFICADO`) gana.
 */
describe('ListaEsperaMatcherService · procesarHuecoLiberado (E4-02 · D22)', () => {
  const AHORA = new Date('2026-10-20T12:00:00.000Z');
  const BARBERIA_ID = '22222222-2222-4222-8222-222222222222';
  const USUARIO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USUARIO_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  /** Hueco de 60 minutos: 14:00 → 15:00 UTC del 25 de octubre de 2026. */
  const payload = {
    barberiaId: BARBERIA_ID,
    fecha: '2026-10-25',
    inicio: '2026-10-25T14:00:00.000Z',
    fin: '2026-10-25T15:00:00.000Z',
    reservaId: 'reserva-1',
  };

  let service: ListaEsperaMatcherService;
  let prisma: {
    barberia: { findUnique: ReturnType<typeof vi.fn> };
    listaEspera: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let notificacion: { enviarNotificacion: ReturnType<typeof vi.fn> };

  /** Candidata FIFO con la forma que devuelve el `select` del matcher. */
  const candidata = (
    id: string,
    usuarioId: string,
    creadoAt: string,
    duraciones: number[],
  ) => ({
    id,
    usuarioId,
    creadoAt: new Date(creadoAt),
    servicios: duraciones.map((duracionEstimada, indice) => ({
      id: `servicio-${id}-${indice}`,
      nombre: `Servicio ${indice}`,
      duracionEstimada,
    })),
    usuario: {
      nombreCompleto: `Cliente ${usuarioId.slice(0, 4)}`,
      correo: `cliente-${usuarioId.slice(0, 4)}@test.com`,
      telefono: '+18095550000',
    },
  });

  beforeEach(() => {
    prisma = {
      barberia: {
        findUnique: vi.fn().mockResolvedValue({
          nombre: 'Sede Centro',
          zonaHoraria: 'America/Santo_Domingo',
          configuracionBarberia: { margenGrupalMinutos: 10 },
        }),
      },
      listaEspera: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      // `withSerializableTransaction` abre la transacción y le pasa el mismo
      // mock como cliente: el test mira la operación, no la transacción.
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };

    notificacion = { enviarNotificacion: vi.fn().mockResolvedValue({ id: 'notificacion-1' }) };

    service = new ListaEsperaMatcherService(
      prisma as unknown as ConstructorParameters<typeof ListaEsperaMatcherService>[0],
      new TiempoService(() => AHORA),
      notificacion as unknown as ConstructorParameters<typeof ListaEsperaMatcherService>[2],
    );
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('sin candidatas no escribe ni notifica', async () => {
    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado).toEqual({
      resultado: 'SIN_CANDIDATAS',
      suscripcionId: null,
      candidatas: 0,
      descartadasPorDuracion: 0,
    });
    expect(prisma.listaEspera.updateMany).not.toHaveBeenCalled();
    expect(notificacion.enviarNotificacion).not.toHaveBeenCalled();
  });

  it('busca SOLO las vivas de esa sede y fecha, en orden FIFO', async () => {
    await service.procesarHuecoLiberado(payload);

    expect(prisma.listaEspera.findMany).toHaveBeenCalledWith({
      where: {
        barberiaId: BARBERIA_ID,
        fechaObjetivo: new Date('2026-10-25T00:00:00.000Z'),
        estado: ESTADOS_LISTA_ESPERA.PENDIENTE,
      },
      orderBy: [{ creadoAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        usuarioId: true,
        creadoAt: true,
        servicios: { select: { id: true, nombre: true, duracionEstimada: true } },
        usuario: {
          select: {
            nombreCompleto: true,
            correo: true,
            telefono: true,
          },
        },
      },
    });
  });

  it('FIFO: descarta a quien no cabe y avisa al siguiente de la fila', async () => {
    // El hueco es de 60 min y el margen de la sede 10 → caben 50 min de servicios.
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [60]),
      candidata('espera-2', USUARIO_2, '2026-10-20T10:00:00.000Z', [30]),
    ]);

    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('NOTIFICADO');
    expect(resultado.suscripcionId).toBe('espera-2');
    expect(resultado.candidatas).toBe(2);
    expect(resultado.descartadasPorDuracion).toBe(1);
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledWith({
      where: { id: 'espera-2', estado: ESTADOS_LISTA_ESPERA.PENDIENTE },
      data: {
        estado: ESTADOS_LISTA_ESPERA.NOTIFICADO,
        actualizadoAt: AHORA,
      },
    });
  });

  it('un hueco = un aviso: si dos caben, el segundo SIGUE PENDIENTE', async () => {
    // 90 min de hueco: los dos (30 + 10 de margen) cabrían.
    const payloadLargo = {
      ...payload,
      inicio: '2026-10-25T13:00:00.000Z',
      fin: '2026-10-25T14:30:00.000Z',
    };

    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
      candidata('espera-2', USUARIO_2, '2026-10-20T10:00:00.000Z', [30]),
    ]);

    const resultado = await service.procesarHuecoLiberado(payloadLargo);

    expect(resultado.suscripcionId).toBe('espera-1');
    // Una sola escritura: la segunda candidata no se toca (sigue PENDIENTE).
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'espera-1', estado: 'PENDIENTE' } }),
    );
    expect(notificacion.enviarNotificacion).toHaveBeenCalledTimes(1);
    expect(notificacion.enviarNotificacion).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: USUARIO_1, tipo: 'LISTA_ESPERA_HUECO_LIBERADO' }),
    );
  });

  it('si otro worker ya la tomó (count 0), pasa a la siguiente y NO avisa de la primera', async () => {
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
      candidata('espera-2', USUARIO_2, '2026-10-20T10:00:00.000Z', [30]),
    ]);
    prisma.listaEspera.updateMany
      .mockResolvedValueOnce({ count: 0 }) // la ganó otro worker
      .mockResolvedValueOnce({ count: 1 });

    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('NOTIFICADO');
    expect(resultado.suscripcionId).toBe('espera-2');
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledTimes(2);
    expect(notificacion.enviarNotificacion).toHaveBeenCalledTimes(1);
    expect(notificacion.enviarNotificacion).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: USUARIO_2 }),
    );
  });

  it('si todas las que caben las tomó otro worker, no hay aviso (YA_TOMADAS)', async () => {
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
    ]);
    prisma.listaEspera.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('YA_TOMADAS');
    expect(notificacion.enviarNotificacion).not.toHaveBeenCalled();
  });

  it('NINGUNA_CABE cuando todas piden más tiempo del que el hueco ofrece', async () => {
    // 60 min de hueco, margen 10 → ninguna de 60 min de servicios entra.
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [60]),
    ]);

    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('NINGUNA_CABE');
    expect(resultado.descartadasPorDuracion).toBe(1);
    expect(prisma.listaEspera.updateMany).not.toHaveBeenCalled();
  });

  it('el margen de la sede (D42) cuenta: 20 de margen deja fuera lo que con 10 entraba', async () => {
    // Hueco de 60 min y servicios de 45: con margen 10 (55) entra, con 20 (65) no.
    const payloadCincuenta = { ...payload };
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30, 15]),
    ]);

    const conDiez = await service.procesarHuecoLiberado(payloadCincuenta);
    expect(conDiez.resultado).toBe('NOTIFICADO');

    prisma.barberia.findUnique.mockResolvedValue({
      nombre: 'Sede Centro',
      zonaHoraria: 'America/Santo_Domingo',
      configuracionBarberia: { margenGrupalMinutos: 20 },
    });
    prisma.listaEspera.updateMany.mockClear();

    const conVeinte = await service.procesarHuecoLiberado(payloadCincuenta);
    expect(conVeinte.resultado).toBe('NINGUNA_CABE');
    expect(prisma.listaEspera.updateMany).not.toHaveBeenCalled();
  });

  it('sin fila de configuración aplica el margen por defecto de 10 minutos', async () => {
    // Hueco de 39 min: 30 de servicios + 10 de margen = 40 > 39 → no cabe.
    prisma.barberia.findUnique.mockResolvedValue({
      nombre: 'Sede Centro',
      zonaHoraria: 'America/Santo_Domingo',
      configuracionBarberia: null,
    });
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
    ]);

    const resultado = await service.procesarHuecoLiberado({
      ...payload,
      inicio: '2026-10-25T14:00:00.000Z',
      fin: '2026-10-25T14:39:00.000Z',
    });

    expect(resultado.resultado).toBe('NINGUNA_CABE');
  });

  it('descarta payloads imposibles sin consultar la base', async () => {
    const invertido = await service.procesarHuecoLiberado({
      ...payload,
      inicio: payload.fin,
      fin: payload.inicio,
    });
    expect(invertido.resultado).toBe('HUECO_INVALIDO');

    const sinSede = await service.procesarHuecoLiberado({ ...payload, barberiaId: '' });
    expect(sinSede.resultado).toBe('HUECO_INVALIDO');

    expect(prisma.barberia.findUnique).not.toHaveBeenCalled();
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('un bloque que ya terminó no genera aviso', async () => {
    const resultado = await service.procesarHuecoLiberado({
      ...payload,
      fecha: '2026-10-19',
      inicio: '2026-10-19T14:00:00.000Z',
      fin: '2026-10-19T15:00:00.000Z',
    });

    expect(resultado.resultado).toBe('HUECO_EN_EL_PASADO');
    expect(prisma.barberia.findUnique).not.toHaveBeenCalled();
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('un bloque EN CURSO tampoco: no se ofrece un resto parcial como si fuera entero', async () => {
    // AHORA es 2026-10-20T12:00Z; el bloque va de 11:45Z a 12:45Z del MISMO día.
    // Ya no se puede ofrecer "de 11:45 a 12:45" sin mentir sobre el inicio.
    const resultado = await service.procesarHuecoLiberado({
      ...payload,
      fecha: '2026-10-20',
      inicio: '2026-10-20T11:45:00.000Z',
      fin: '2026-10-20T12:45:00.000Z',
    });

    expect(resultado.resultado).toBe('HUECO_EN_EL_PASADO');
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('si la sede no existe no hay nada que avisar', async () => {
    prisma.barberia.findUnique.mockResolvedValue(null);

    const resultado = await service.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('SEDE_INEXISTENTE');
    expect(prisma.listaEspera.findMany).not.toHaveBeenCalled();
  });

  it('la notificación nombra la sede y el bloque liberado', async () => {
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
    ]);

    await service.procesarHuecoLiberado(payload);

    const [dto] = notificacion.enviarNotificacion.mock.calls[0];
    expect(dto).toMatchObject({
      usuarioId: USUARIO_1,
      canal: 'EMAIL',
      tipo: 'LISTA_ESPERA_HUECO_LIBERADO',
    });
    expect(dto.contenido).toContain('Sede Centro');
    expect(dto.contenido).toContain('2026-10-25');
    // 14:00Z → 10:00 en America/Santo_Domingo (UTC-4); 15:00Z → 11:00.
    expect(dto.contenido).toContain('10:00');
    expect(dto.contenido).toContain('11:00');
  });

  it('sin canal de notificaciones el matcher sigue funcionando (solo log)', async () => {
    const sinCanal = new ListaEsperaMatcherService(
      prisma as unknown as ConstructorParameters<typeof ListaEsperaMatcherService>[0],
      new TiempoService(() => AHORA),
    );
    prisma.listaEspera.findMany.mockResolvedValue([
      candidata('espera-1', USUARIO_1, '2026-10-20T09:00:00.000Z', [30]),
    ]);

    const resultado = await sinCanal.procesarHuecoLiberado(payload);

    expect(resultado.resultado).toBe('NOTIFICADO');
    expect(prisma.listaEspera.updateMany).toHaveBeenCalledTimes(1);
  });
});
