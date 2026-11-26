import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/shared/prisma/prisma.service.js';
import { TiempoService } from '../src/shared/time/tiempo.service.js';
import { AuditoriaService } from '../src/auditoria/application/auditoria.service.js';
import { SolicitudAntecedenteService } from '../src/antecedente/application/solicitud-antecedente.service.js';
import { SolicitudAntecedenteSedeController } from '../src/antecedente/infrastructure/solicitud-antecedente.controller.js';

/**
 * T-52 · crear la solicitud de antecedente.
 *
 * El personal de la sede pide; nadie escribe ya un antecedente aprobado por la
 * puerta de atrás. El cliente tiene que haber pasado por la sede (cualquier
 * reserva ya ocurrida, incluidas canceladas) y no puede haber dos PENDIENTES del
 * mismo cliente en la misma sede.
 *
 * En rojo falla porque el servicio y la ruta no existen.
 */
const SEDE = '11111111-1111-4111-8111-111111111111';
const ADMIN_SEDE = '22222222-2222-4222-8222-222222222222';
const BARBERO = '44444444-4444-4444-8444-444444444444';
const CLIENTE = '66666666-6666-4666-8666-666666666666';
const AHORA = new Date('2026-11-25T12:00:00.000Z');

function fecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function hora(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

function prismaFalso() {
  return {
    barberia: { findUnique: vi.fn() },
    usuario: { findUnique: vi.fn() },
    usuarioRol: { findFirst: vi.fn(), findMany: vi.fn() },
    reserva: { findMany: vi.fn() },
    solicitudAntecedente: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

function preparar(prisma: ReturnType<typeof prismaFalso>) {
  const tiempo = {
    ahora: () => AHORA,
    aInstante: (f: string, h: string) => new Date(`${f}T${h}:00.000Z`),
  } as unknown as TiempoService;
  const auditoria = { registrarEvento: vi.fn() } as unknown as AuditoriaService;

  return new SolicitudAntecedenteService(
    prisma as unknown as PrismaService,
    tiempo,
    auditoria,
  );
}

function accesoDeSede(prisma: ReturnType<typeof prismaFalso>, nombre = 'BARBERO') {
  prisma.barberia.findUnique.mockResolvedValue({
    id: SEDE,
    zonaHoraria: 'America/Santo_Domingo',
  });
  prisma.usuarioRol.findFirst.mockResolvedValue({ id: 'rol-sede', rol: { nombre } });
}

const cuerpo = {
  clienteId: CLIENTE,
  motivo: '  Llegó en estado inconveniente y gritó en la sala.  ',
  evidenciaTexto: '  Testigo: recepción  ',
};

describe('T-52 · crear solicitud de antecedente', () => {
  it('crea la solicitud PENDIENTE con el solicitante del token y el texto limpio', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    accesoDeSede(prisma);
    prisma.usuario.findUnique.mockResolvedValue({ id: CLIENTE });
    prisma.reserva.findMany.mockResolvedValue([
      { fechaCita: fecha('2026-11-20'), horaInicio: hora('10:00'), estado: 'COMPLETADA' },
    ]);
    prisma.solicitudAntecedente.findFirst.mockResolvedValue(null);
    prisma.solicitudAntecedente.create.mockResolvedValue({ id: 'sol-1', estado: 'PENDIENTE' });

    const res = await service.crear(BARBERO, SEDE, cuerpo);

    expect(res).toMatchObject({ id: 'sol-1', estado: 'PENDIENTE' });
    expect(prisma.solicitudAntecedente.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barberiaId: SEDE,
          solicitanteId: BARBERO,
          clienteId: CLIENTE,
          motivo: 'Llegó en estado inconveniente y gritó en la sala.',
          evidenciaTexto: 'Testigo: recepción',
          estado: 'PENDIENTE',
        }),
      }),
    );
  });

  it('422 CLIENTE_SIN_RELACION_CON_SEDE si nunca hubo una reserva ya ocurrida', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    accesoDeSede(prisma);
    prisma.usuario.findUnique.mockResolvedValue({ id: CLIENTE });
    prisma.reserva.findMany.mockResolvedValue([]);

    const error = await service.crear(BARBERO, SEDE, cuerpo).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 422,
      response: { codigo: 'CLIENTE_SIN_RELACION_CON_SEDE' },
    });
    expect(prisma.solicitudAntecedente.create).not.toHaveBeenCalled();
  });

  it('una reserva futura todavía no ocurrida no da relación con la sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    accesoDeSede(prisma);
    prisma.usuario.findUnique.mockResolvedValue({ id: CLIENTE });
    prisma.reserva.findMany.mockResolvedValue([
      { fechaCita: fecha('2030-01-10'), horaInicio: hora('10:00'), estado: 'PENDIENTE' },
    ]);

    const error = await service.crear(BARBERO, SEDE, cuerpo).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 422,
      response: { codigo: 'CLIENTE_SIN_RELACION_CON_SEDE' },
    });
  });

  it('una reserva cancelada del pasado sí cuenta como relación', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    accesoDeSede(prisma);
    prisma.usuario.findUnique.mockResolvedValue({ id: CLIENTE });
    prisma.reserva.findMany.mockResolvedValue([
      { fechaCita: fecha('2026-11-10'), horaInicio: hora('18:00'), estado: 'CANCELADA' },
    ]);
    prisma.solicitudAntecedente.findFirst.mockResolvedValue(null);
    prisma.solicitudAntecedente.create.mockResolvedValue({ id: 'sol-2' });

    await expect(service.crear(BARBERO, SEDE, cuerpo)).resolves.toMatchObject({ id: 'sol-2' });
  });

  it('409 SOLICITUD_ANTECEDENTE_PENDIENTE si ya hay una pendiente del cliente en la sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    accesoDeSede(prisma);
    prisma.usuario.findUnique.mockResolvedValue({ id: CLIENTE });
    prisma.reserva.findMany.mockResolvedValue([
      { fechaCita: fecha('2026-11-20'), horaInicio: hora('10:00'), estado: 'COMPLETADA' },
    ]);
    prisma.solicitudAntecedente.findFirst.mockResolvedValue({ id: 'sol-existente' });

    const error = await service.crear(BARBERO, SEDE, cuerpo).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      response: { codigo: 'SOLICITUD_ANTECEDENTE_PENDIENTE' },
    });
    expect(prisma.solicitudAntecedente.create).not.toHaveBeenCalled();
  });

  it('403 si el usuario no tiene rol de sede', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, zonaHoraria: 'UTC' });
    prisma.usuarioRol.findFirst.mockResolvedValue(null);

    const error = await service.crear(BARBERO, SEDE, cuerpo).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 403 });
    expect(prisma.solicitudAntecedente.create).not.toHaveBeenCalled();
  });

  it('la bandeja del ADMIN_BARBERIA ve las de su sede y el BARBERO solo las suyas', async () => {
    const prisma = prismaFalso();
    const service = preparar(prisma);
    prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, zonaHoraria: 'UTC' });
    prisma.solicitudAntecedente.findMany.mockResolvedValue([]);

    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'ADMIN_BARBERIA' } });
    await service.listar(ADMIN_SEDE, SEDE);
    expect(prisma.solicitudAntecedente.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barberiaId: SEDE }) }),
    );

    prisma.usuarioRol.findFirst.mockResolvedValue({ rol: { nombre: 'BARBERO' } });
    await service.listar(BARBERO, SEDE);
    expect(prisma.solicitudAntecedente.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barberiaId: SEDE, solicitanteId: BARBERO }),
      }),
    );
  });

  it('declara POST y GET bajo /shops/:shopId/antecedentes/solicitudes', () => {
    const proto = SolicitudAntecedenteSedeController.prototype as unknown as Record<string, unknown>;
    const rutas = Object.getOwnPropertyNames(proto)
      .map((nombre) => proto[nombre])
      .filter((candidato) => typeof candidato === 'function')
      .map((candidato) => ({
        ruta: Reflect.getMetadata(PATH_METADATA, candidato) as string | undefined,
        metodo: Reflect.getMetadata(METHOD_METADATA, candidato) as number | undefined,
      }));

    expect(rutas).toEqual(
      expect.arrayContaining([
        { ruta: '/', metodo: RequestMethod.POST },
        { ruta: '/', metodo: RequestMethod.GET },
      ]),
    );
  });
});
