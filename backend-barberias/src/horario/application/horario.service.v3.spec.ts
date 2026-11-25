import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HorarioService } from './horario.service.js';

/**
 * V3 · plantilla semanal BASE del barbero y autoría de las excepciones.
 *
 * Lo que se fija aquí son las dos reglas que la base no puede decidir sola:
 *  - un día activo necesita horas válidas y en orden, y un día apagado sin horas
 *    solo apaga lo que ya existía (no inventa un bloque vacío);
 *  - el ORIGEN del cambio se deduce de quién escribe: el propio barbero deja
 *    BARBERO; un operador de la sede que toca la agenda de otro deja ADMIN_SEDE;
 *    y un barbero que intenta tocar la de otro recibe 403.
 */
describe('HorarioService · plantilla base y autoría (V3)', () => {
  let service: HorarioService;
  let prisma: any;
  let filasDePlantilla: Map<number, any>;
  /** F4-03: la propuesta pendiente que el `PUT` mantiene por (barbero, sede). */
  let propuestaPendiente: any;

  const tiempo = {
    fechaDeCalendario: (fecha: string) => new Date(`${fecha}T00:00:00Z`),
  } as any;

  /** Rol que devuelve `usuarioRol.findFirst` según lo que pregunte el servicio. */
  function rolesDe(usuario: {
    esGlobal?: boolean;
    esAdminSede?: boolean;
    esBarbero?: boolean;
  }) {
    return vi.fn(async ({ where }: any) => {
      const nombre = where?.rol?.nombre;
      if (nombre === 'ADMINISTRADOR') return usuario.esGlobal ? { id: 'r-global' } : null;
      if (nombre === 'ADMIN_BARBERIA') return usuario.esAdminSede ? { id: 'r-admin' } : null;
      if (nombre === 'BARBERO') return usuario.esBarbero === false ? null : { id: 'r-barbero' };
      return null;
    });
  }

  beforeEach(() => {
    filasDePlantilla = new Map();
    propuestaPendiente = null;

    prisma = {
      barberia: { findUnique: vi.fn(async () => ({ responsableId: null })) },
      usuarioRol: { findFirst: rolesDe({ esGlobal: false, esAdminSede: false }) },
      excepcionHorarioBarbero: {
        upsert: vi.fn(async ({ create }: any) => ({ id: 'excepcion-1', ...create })),
      },
      horarioBaseBarbero: {
        findMany: vi.fn(async () =>
          Array.from(filasDePlantilla.values()).sort((a, b) => a.diaSemana - b.diaSemana),
        ),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const diaSemana = where.barberoId_diaSemana.diaSemana;
          const fila = filasDePlantilla.has(diaSemana)
            ? { ...filasDePlantilla.get(diaSemana), ...update }
            : create;
          filasDePlantilla.set(diaSemana, fila);
          return fila;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const fila = filasDePlantilla.get(where.diaSemana);
          if (!fila) return { count: 0 };
          filasDePlantilla.set(where.diaSemana, { ...fila, ...data });
          return { count: 1 };
        }),
      },
      propuestaHorarioBase: {
        findFirst: vi.fn(async () => propuestaPendiente),
        create: vi.fn(async ({ data }: any) => {
          propuestaPendiente = { id: 'propuesta-1', creadoAt: new Date(), ...data };
          return propuestaPendiente;
        }),
        update: vi.fn(async ({ data }: any) => {
          propuestaPendiente = { ...propuestaPendiente, ...data };
          return propuestaPendiente;
        }),
        updateMany: vi.fn(async ({ data }: any) => {
          if (!propuestaPendiente) return { count: 0 };
          propuestaPendiente = { ...propuestaPendiente, ...data };
          return { count: 1 };
        }),
      },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };

    service = new HorarioService(prisma, tiempo);
  });

  // ── plantilla base ───────────────────────────────────────────────────────

  it('la plantilla vacía devuelve los siete días ISO y avisa de que no hay ninguna', async () => {
    const plantilla = await service.obtenerPlantillaBase('barbero-1', 'sede-1');

    expect(plantilla.dias.map((d) => d.diaSemana)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plantilla.sinPlantilla).toBe(true);
    expect(plantilla.dias.every((d) => d.horaInicio === null && d.activo === false)).toBe(true);
    expect(plantilla.propuestaPendiente).toBeNull();
  });

  it('F4-03 · el envío crea una propuesta PENDIENTE y NO escribe la plantilla vigente', async () => {
    filasDePlantilla.set(3, {
      barberoId: 'barbero-1',
      diaSemana: 3,
      horaInicio: '10:00',
      horaFin: '19:00',
      activo: true,
    });

    const plantilla = await service.guardarPlantillaBase('barbero-1', 'sede-1', {
      dias: [
        { diaSemana: 1, horaInicio: '09:00', horaFin: '18:00' },
        { diaSemana: 7, horaInicio: '09:00', horaFin: '13:00' },
      ],
    });

    expect(prisma.horarioBaseBarbero.upsert).not.toHaveBeenCalled();
    expect(propuestaPendiente).toMatchObject({ barberoId: 'barbero-1', estado: 'PENDIENTE' });

    const dias = propuestaPendiente.dias;
    expect(dias).toHaveLength(7);
    // La propuesta guarda la semana RESULTANTE: lo enviado y lo que sigue vigente.
    expect(dias.find((d: any) => d.diaSemana === 3)).toMatchObject({
      horaInicio: '10:00',
      horaFin: '19:00',
      activo: true,
    });
    expect(dias.find((d: any) => d.diaSemana === 1)).toMatchObject({
      horaInicio: '09:00',
      horaFin: '18:00',
      activo: true,
    });

    // La lectura sigue devolviendo la VIGENTE en `dias` y la propuesta aparte.
    expect(plantilla.dias.find((d) => d.diaSemana === 3)).toMatchObject({ horaInicio: '10:00' });
    expect(plantilla.dias.find((d) => d.diaSemana === 1)?.horaInicio).toBeNull();
    expect(plantilla.propuestaPendiente?.estado).toBe('PENDIENTE');
  });

  it('un segundo envío reemplaza la propuesta pendiente, no crea otra', async () => {
    await service.guardarPlantillaBase('barbero-1', 'sede-1', {
      dias: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '18:00' }],
    });
    await service.guardarPlantillaBase('barbero-1', 'sede-1', {
      dias: [{ diaSemana: 1, horaInicio: '11:00', horaFin: '20:00' }],
    });

    expect(prisma.propuestaHorarioBase.create).toHaveBeenCalledTimes(1);
    expect(prisma.propuestaHorarioBase.update).toHaveBeenCalledTimes(1);
    expect(propuestaPendiente.dias.find((d: any) => d.diaSemana === 1)).toMatchObject({
      horaInicio: '11:00',
      horaFin: '20:00',
    });
  });

  it('un día apagado sin horas solo apaga el bloque en la propuesta, no lo crea', async () => {
    filasDePlantilla.set(2, {
      barberoId: 'barbero-1',
      diaSemana: 2,
      horaInicio: '09:00',
      horaFin: '18:00',
      activo: true,
    });

    const plantilla = await service.guardarPlantillaBase('barbero-1', 'sede-1', {
      dias: [{ diaSemana: 2, activo: false }, { diaSemana: 5, activo: false }],
    });

    expect(prisma.horarioBaseBarbero.upsert).not.toHaveBeenCalled();
    expect(filasDePlantilla.has(5)).toBe(false);

    const dias = propuestaPendiente.dias;
    // El 2 conserva sus horas (apagar no borra el bloque) y el 5 nace vacío.
    expect(dias.find((d: any) => d.diaSemana === 2)).toMatchObject({
      horaInicio: '09:00',
      horaFin: '18:00',
      activo: false,
    });
    expect(dias.find((d: any) => d.diaSemana === 5)).toMatchObject({
      horaInicio: null,
      activo: false,
    });
    expect(plantilla.propuestaPendiente).toBeTruthy();
  });

  it('un día ACTIVO sin horas es 400 y no escribe ninguna propuesta', async () => {
    await expect(
      service.guardarPlantillaBase('barbero-1', 'sede-1', {
        dias: [{ diaSemana: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.propuestaHorarioBase.create).not.toHaveBeenCalled();
    expect(prisma.propuestaHorarioBase.update).not.toHaveBeenCalled();
  });

  it('rechaza una jornada invertida', async () => {
    await expect(
      service.guardarPlantillaBase('barbero-1', 'sede-1', {
        dias: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '09:00' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza el mismo día dos veces', async () => {
    await expect(
      service.guardarPlantillaBase('barbero-1', 'sede-1', {
        dias: [
          { diaSemana: 1, horaInicio: '09:00', horaFin: '18:00' },
          { diaSemana: 1, horaInicio: '10:00', horaFin: '19:00' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo el barbero de la sede puede guardar SU plantilla', async () => {
    // Admin de la sede, pero sin rol BARBERO: la plantilla es de quien la vive.
    prisma.usuarioRol.findFirst = rolesDe({ esGlobal: false, esAdminSede: true, esBarbero: false });

    await expect(
      service.guardarPlantillaBase('admin-1', 'sede-1', {
        dias: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '18:00' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── autoría de las excepciones ───────────────────────────────────────────

  it('el propio barbero queda como origen BARBERO', async () => {
    await service.addBarberException('barbero-1', 'sede-1', 'barbero-1', {
      fecha: '2026-11-10',
      tipo: 'CERRADA' as any,
    });

    const { create, update } = prisma.excepcionHorarioBarbero.upsert.mock.calls[0][0];
    for (const datos of [create, update]) {
      expect(datos.modificadoPor).toBe('BARBERO');
      expect(datos.modificadoPorId).toBe('barbero-1');
    }
  });

  it('un operador de la sede sobre la agenda de otro queda como ADMIN_SEDE', async () => {
    prisma.usuarioRol.findFirst = rolesDe({ esAdminSede: true });

    await service.addBarberException('admin-1', 'sede-1', 'barbero-2', {
      fecha: '2026-11-10',
      tipo: 'CERRADA' as any,
    });

    const { create } = prisma.excepcionHorarioBarbero.upsert.mock.calls[0][0];
    expect(create.modificadoPor).toBe('ADMIN_SEDE');
    expect(create.modificadoPorId).toBe('admin-1');
  });

  it('un barbero no puede escribir la agenda de otro: 403 sin tocar la base', async () => {
    prisma.usuarioRol.findFirst = rolesDe({
      esGlobal: false,
      esAdminSede: false,
      esBarbero: true,
    });

    await expect(
      service.addBarberException('barbero-1', 'sede-1', 'barbero-2', {
        fecha: '2026-11-10',
        tipo: 'CERRADA' as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.excepcionHorarioBarbero.upsert).not.toHaveBeenCalled();
  });
});
