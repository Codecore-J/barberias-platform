import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ConfiguracionBarberiaService } from '../src/barberia/application/configuracion-barberia.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';

const BARBERIA_ID = '9f0b0000-0000-4000-8000-000000000001';
const USUARIO_ID = '9f0b0000-0000-4000-8000-000000000002';
const INSTANTE_FIJO = new Date('2026-10-11T12:00:00.000Z');

function nuevoPrisma() {
  const prisma: any = {
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: BARBERIA_ID }]),
    barberia: { findUnique: vi.fn() },
    configuracionBarberia: { findUnique: vi.fn(), update: vi.fn() },
    reserva: { count: vi.fn() },
  };
  return prisma;
}

const baseConfig = {
  barberiaId: BARBERIA_ID,
  modoReserva: 'MANUAL',
  aceptaIndividual: true,
  aceptaGrupal: true,
  maxPendientes: 3,
  horizonteReservaDias: 30,
  nuevasReservasActivas: true,
  margenGrupalMinutos: 10,
  permiteCancelacionEspecial: false,
  oportunidadesEspacioActivas: true,
  maxNinos: 10,
  maxPersonasTotal: 20,
  motivoPausa: null,
  pausaDesde: null,
  reactivacionProgramada: null,
  reactivacionReal: null,
};

const usuarioAdmin = {
  id: USUARIO_ID,
  correo: 'admin@test.com',
  roles: ['ADMINISTRADOR'],
};

describe('ConfiguracionBarberiaService (E3-11)', () => {
  let prisma: any;
  let service: ConfiguracionBarberiaService;
  let auditoria: any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = nuevoPrisma();
    auditoria = { registrarEvento: vi.fn().mockResolvedValue({}) };

    service = new ConfiguracionBarberiaService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
      new TiempoService(() => INSTANTE_FIJO),
    );
  });

  function prepararActualizacion(config: Partial<typeof baseConfig> = {}, pendientes = 0) {
    prisma.barberia.findUnique.mockResolvedValue({ id: BARBERIA_ID });
    prisma.configuracionBarberia.findUnique.mockResolvedValue({ ...baseConfig, ...config });
    prisma.reserva.count.mockResolvedValue(pendientes);
    prisma.configuracionBarberia.update.mockImplementation(async ({ data }: any) => ({
      ...baseConfig,
      ...config,
      ...data,
    }));
  }

  async function capturarError(promesa: Promise<unknown>) {
    try {
      await promesa;
    } catch (error: any) {
      const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
      return { ...respuesta };
    }
    throw new Error('Se esperaba una excepción y la promesa se resolvió.');
  }

  it('mapea la entidad campo por campo (no devuelve columnas internas)', async () => {
    prisma.configuracionBarberia.findUnique.mockResolvedValue({
      ...baseConfig,
      campoInternoNoExpuesto: 'secreto',
    });

    const result = await service.getConfiguracion(BARBERIA_ID);

    expect(result).toEqual({
      barberiaId: BARBERIA_ID,
      modoReserva: 'MANUAL',
      aceptaIndividual: true,
      aceptaGrupal: true,
      maxPendientes: 3,
      maxNinos: 10,
      maxPersonasTotal: 20,
      horizonteReservaDias: 30,
      nuevasReservasActivas: true,
      margenGrupalMinutos: 10,
      permiteCancelacionEspecial: false,
      oportunidadesEspacioActivas: true,
      motivoPausa: null,
      pausaDesde: null,
      reactivacionProgramada: null,
      reactivacionReal: null,
    });
    expect(result).not.toHaveProperty('campoInternoNoExpuesto');
  });

  it('lanza si la configuración no existe', async () => {
    prisma.configuracionBarberia.findUnique.mockResolvedValue(null);

    await expect(service.getConfiguracion(BARBERIA_ID)).rejects.toThrow(ForbiddenException);
  });// --- Regla 2: 409 CONFLICT HAY_PENDIENTES con conteo -----------------------------

  it.each([
    ['modoReserva', { modoReserva: 'AUTOMATICO' as const }, 2],
    ['aceptaIndividual', { aceptaIndividual: false }, 3],
    ['aceptaGrupal', { aceptaGrupal: false }, 1],
    ['maxPendientes', { maxPendientes: 5 }, 4],
  ])
  ('bloquea 409 CONFLICT HAY_PENDIENTES con el conteo al cambiar %s con reservas en curso',
    async (_campo, dto, pendientes) => {
      prepararActualizacion({}, pendientes as number);

      const error = await capturarError(
        service.actualizarConfiguracion(BARBERIA_ID, dto as any, usuarioAdmin),
      );

      expect(error).toMatchObject({
        statusCode: 409,
        codigo: 'CONFIG_CON_PENDIENTES',
        mensaje: expect.stringContaining(`${pendientes} reserva(s) pendiente(s)`),
      });
    },
  );

  it('no bloquea cambiar un campo no sensible aunque haya reservas en curso', async () => {
    prepararActualizacion({}, 2);

    const result = await service.actualizarConfiguracion(
      BARBERIA_ID,
      { horizonteReservaDias: 15 },
      usuarioAdmin,
    );

    expect(result.horizonteReservaDias).toBe(15);
    expect(result.maxNinos).toBe(10);
  });

  it('permite cambiar modoReserva cuando no hay reservas en curso', async () => {
    prepararActualizacion({}, 0);

    const result = await service.actualizarConfiguracion(
      BARBERIA_ID,
      { modoReserva: 'AUTOMATICO' },
      usuarioAdmin,
    );

    expect(result.modoReserva).toBe('AUTOMATICO');
  });

  // --- Regla 3: validaciones numéricas y max_personas_total >= max_ninos+1 --

  it('rechaza max_personas_total < max_ninos + 1 cuando se envían ambos', async () => {
    prepararActualizacion({}, 0);

    const error = await capturarError(
      service.actualizarConfiguracion(BARBERIA_ID, { maxNinos: 5, maxPersonasTotal: 5 }, usuarioAdmin),
    );

    expect(error).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  it('rechaza el estado resultante inválido al enviar solo maxPersonasTotal (usa el maxNinos persistido)', async () => {
    prepararActualizacion({ maxNinos: 10, maxPersonasTotal: 20 }, 0);

    const error = await capturarError(
      service.actualizarConfiguracion(BARBERIA_ID, { maxPersonasTotal: 5 }, usuarioAdmin),
    );

    expect(error).toMatchObject({
      statusCode: 422,
      codigo: 'VALIDACION',
      maxNinos: 10,
      maxPersonasTotal: 5,
    });
  });

  it('rechaza el estado resultante inválido al enviar solo maxNinos (usa el maxPersonasTotal persistido)', async () => {
    prepararActualizacion({ maxNinos: 2, maxPersonasTotal: 3 }, 0);

    const error = await capturarError(
      service.actualizarConfiguracion(BARBERIA_ID, { maxNinos: 5 }, usuarioAdmin),
    );

    expect(error).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  it('acepta max_personas_total = max_ninos + 1 (borde exacto)', async () => {
    prepararActualizacion({}, 0);

    const result = await service.actualizarConfiguracion(
      BARBERIA_ID,
      { maxNinos: 5, maxPersonasTotal: 6 },
      usuarioAdmin,
    );

    expect(result.maxNinos).toBe(5);
    expect(result.maxPersonasTotal).toBe(6);
  });

  it('rechaza límites < 1', async () => {
    prepararActualizacion({}, 0);

    const error = await capturarError(
      service.actualizarConfiguracion(BARBERIA_ID, { maxPendientes: 0 }, usuarioAdmin),
    );

    expect(error).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  // --- Regla 4: pausa / reactivación --------------------------------------

  it('al pausar guarda motivo_pausa y pausa_desde', async () => {
    prepararActualizacion({ nuevasReservasActivas: true }, 0);

    const result = await service.actualizarConfiguracion(
      BARBERIA_ID,
      { nuevasReservasActivas: false, motivoPausa: 'Vacaciones' },
      usuarioAdmin,
    );

    expect(result.nuevasReservasActivas).toBe(false);
    expect(result.motivoPausa).toBe('Vacaciones');
    expect(result.pausaDesde).toEqual(INSTANTE_FIJO);
  });

  it('exige motivo_pausa para pausar', async () => {
    prepararActualizacion({ nuevasReservasActivas: true }, 0);

    const error = await capturarError(
      service.actualizarConfiguracion(BARBERIA_ID, { nuevasReservasActivas: false }, usuarioAdmin),
    );

    expect(error).toMatchObject({ statusCode: 422, codigo: 'VALIDACION' });
  });

  it('al reactivar limpia motivo_pausa, pausa_desde y reactivacion_programada', async () => {
    prepararActualizacion(
      {
        nuevasReservasActivas: false,
        motivoPausa: 'Vacaciones',
        pausaDesde: INSTANTE_FIJO,
        reactivacionProgramada: INSTANTE_FIJO,
      },
      0,
    );

    const result = await service.actualizarConfiguracion(
      BARBERIA_ID,
      { nuevasReservasActivas: true },
      usuarioAdmin,
    );

    expect(result.nuevasReservasActivas).toBe(true);
    expect(result.motivoPausa).toBeNull();
    expect(result.pausaDesde).toBeNull();
    expect(result.reactivacionProgramada).toBeNull();
  });

  it('audita CONFIG_ACTUALIZADA con el valor anterior y el nuevo', async () => {
    prepararActualizacion({}, 0);

    await service.actualizarConfiguracion(
      BARBERIA_ID,
      { horizonteReservaDias: 15 },
      usuarioAdmin,
    );

    expect(auditoria.registrarEvento).toHaveBeenCalledTimes(1);
    const [evento] = auditoria.registrarEvento.mock.calls[0];
    expect(evento).toMatchObject({
      usuarioId: USUARIO_ID,
      accion: 'CONFIG_ACTUALIZADA',
      entidad: 'configuracion_barberia',
      entidadId: BARBERIA_ID,
    });
    expect(evento.contexto.anterior.horizonteReservaDias).toBe(30);
    expect(evento.contexto.nuevo.horizonteReservaDias).toBe(15);
  });
});