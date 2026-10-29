import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HorarioService } from './horario.service.js';

/**
 * V3 fase 5 · semana propia del barbero.
 *
 * Lo que se fija aquí es la regla que el motor de disponibilidad da por hecha:
 * un día libre no tiene horas, un día trabajado sí y en orden, y el descanso
 * (almuerzo) va completo y DENTRO de la jornada. Si estas validaciones se
 * relajaran, la base las seguiría rechazando por el CHECK y el barbero vería un
 * 500 en vez de un mensaje.
 */
describe('HorarioService · mi-horario (V3 fase 5)', () => {
  let service: HorarioService;
  let prisma: any;

  const tiempo = {
    fechaDeCalendario: (fecha: string) => new Date(`${fecha}T00:00:00Z`),
  } as any;

  function time(h: number, m: number): Date {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  function dia(diaSemana: number, extra: Record<string, unknown> = {}) {
    return {
      diaSemana,
      esDiaLibre: false,
      horaInicio: '09:00',
      horaFin: '18:00',
      horaInicioDescanso: null,
      horaFinDescanso: null,
      ...extra,
    };
  }

  beforeEach(() => {
    const creadas = new Map<number, any>();

    prisma = {
      usuarioRol: { findFirst: vi.fn(async () => ({ id: 'rol-barbero' })) },
      horarioBarbero: {
        findMany: vi.fn(async () =>
          Array.from(creadas.values()).sort((a, b) => a.diaSemana - b.diaSemana),
        ),
        deleteMany: vi.fn(async () => {
          creadas.clear();
          return { count: 0 };
        }),
        createMany: vi.fn(async ({ data }: any) => {
          for (const fila of data) creadas.set(fila.diaSemana, fila);
          return { count: data.length };
        }),
      },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };

    service = new HorarioService(prisma, tiempo);
  });

  it('GET devuelve los siete días y avisa de que todavía hereda el horario de la sede', async () => {
    const semana = await service.getMiHorario('barbero-1', 'sede-1');

    expect(semana.dias).toHaveLength(7);
    expect(semana.dias.map((d) => d.diaSemana)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(semana.heredaHorarioSede).toBe(true);
    expect(semana.dias.every((d) => d.horaInicio === null)).toBe(true);
  });

  it('rechaza con 403 a quien no es BARBERO de la sede', async () => {
    prisma.usuarioRol.findFirst = vi.fn(async () => null);

    await expect(service.getMiHorario('admin-1', 'sede-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('guarda la semana completa, con el día libre en null y el descanso en sus horas', async () => {
    await service.configurarMiHorario('barbero-1', 'sede-1', {
      dias: [
        dia(1, { horaInicioDescanso: '12:00', horaFinDescanso: '13:00' }),
        dia(2),
        dia(3),
        dia(4),
        dia(5),
        dia(6),
        dia(7, { esDiaLibre: true, horaInicio: null, horaFin: null }),
      ],
    });

    const filas = prisma.horarioBarbero.createMany.mock.calls[0][0].data;
    expect(filas).toHaveLength(7);

    const lunes = filas.find((f: any) => f.diaSemana === 1);
    expect(lunes.horaInicioDescanso).toEqual(time(12, 0));
    expect(lunes.horaFinDescanso).toEqual(time(13, 0));

    const domingo = filas.find((f: any) => f.diaSemana === 7);
    expect(domingo.esDiaLibre).toBe(true);
    expect(domingo.horaInicio).toBeNull();
    expect(domingo.horaFin).toBeNull();
  });

  it('el guardado responde con la semana normalizada en HH:mm (no con el ISO de un TIME)', async () => {
    const semana = await service.configurarMiHorario('barbero-1', 'sede-1', {
      dias: [dia(1, { horaInicioDescanso: '12:00', horaFinDescanso: '13:00' })],
    });

    const lunes = semana.dias.find((d) => d.diaSemana === 1);
    expect(lunes).toEqual({
      diaSemana: 1,
      esDiaLibre: false,
      horaInicio: '09:00',
      horaFin: '18:00',
      horaInicioDescanso: '12:00',
      horaFinDescanso: '13:00',
    });
    expect(semana.heredaHorarioSede).toBe(false);
  });

  it('rechaza un descanso fuera de la jornada', async () => {
    await expect(
      service.configurarMiHorario('barbero-1', 'sede-1', {
        dias: [dia(1, { horaInicioDescanso: '08:00', horaFinDescanso: '09:30' })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un descanso a medias', async () => {
    await expect(
      service.configurarMiHorario('barbero-1', 'sede-1', {
        dias: [dia(1, { horaInicioDescanso: '12:00' })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un día libre con descanso configurado', async () => {
    await expect(
      service.configurarMiHorario('barbero-1', 'sede-1', {
        dias: [
          dia(7, {
            esDiaLibre: true,
            horaInicio: null,
            horaFin: null,
            horaInicioDescanso: '12:00',
            horaFinDescanso: '13:00',
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un día de trabajo sin horas', async () => {
    await expect(
      service.configurarMiHorario('barbero-1', 'sede-1', {
        dias: [dia(1, { horaInicio: null, horaFin: null })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza el mismo día dos veces', async () => {
    await expect(
      service.configurarMiHorario('barbero-1', 'sede-1', {
        dias: [dia(1), dia(1)],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
