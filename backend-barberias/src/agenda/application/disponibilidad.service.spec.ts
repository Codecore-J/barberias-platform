import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { DisponibilidadService } from './disponibilidad.service.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';

/**
 * E1-06 · parte 3: `calcularDisponibilidadDeSolicitante` es la puerta que
 * impide leer la agenda de una sede ajena.
 *
 * Antes, el guard y el decorador solo miraban el ROL, y el `CLIENTE` es GLOBAL
 * con `barberia_id` nulo: `alcanceCumple` lo dejaba pasar contra cualquier sede.
 * Estos tests fijan que la pertenencia se exige de verdad.
 */
describe('DisponibilidadService · calcularDisponibilidadDeSolicitante (E1-06)', () => {
  let service: DisponibilidadService;
  let prisma: any;

  beforeEach(() => {
    // `esAdministradorGlobalPorId` busca ADMINISTRADOR; `perteneceABarberia`
    // busca usuario_roles y cliente_barberias. El mock separa ambos por la
    // tabla que se consulta para que el test exprese la regla y no el mock.
    prisma = {
      // E2-04: la disponibilidad lee la zona horaria de la sede.
      barberia: {
        findUnique: vi.fn(async () => ({ zonaHoraria: 'America/Santo_Domingo' })),
      },
      usuarioRol: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where.rol?.nombre === 'ADMINISTRADOR') return null;
          return where.barberiaId === 'sede-propia' ? { id: 'rol-1' } : null;
        }),
      },
      clienteBarberia: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.barberiaId === 'sede-propia' ? { id: 'vinculo-1' } : null,
        ),
      },
      horario: { findFirst: vi.fn(async () => null) },
      excepcionHorario: { findFirst: vi.fn(async () => null) },
    };
    service = new DisponibilidadService(prisma);
  });

  const solicitud = (barberiaId: string) => ({
    barberiaId,
    fecha: new Date('2026-10-05T00:00:00Z'),
    duracionTotal: 30,
    margenRequerido: 0,
  });

  it('permite consultar cuando el solicitante tiene rol en esa sede', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-propia'), 'barbero-1'),
    ).resolves.toEqual([]);
  });

  it('permite consultar cuando el solicitante está vinculado por cliente_barberias', async () => {
    // El mock de usuario_roles devuelve null para cualquier sede que no sea
    // 'sede-propia'; aquí la pertenencia llega por la segunda tabla.
    prisma.clienteBarberia.findFirst = vi.fn(async () => ({ id: 'vinculo-1' }));

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).resolves.toEqual([]);
  });

  it('RECHAZA con 403 a un cliente que pide la disponibilidad de otra sede', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el 403 dice que no pertenece, no que el rol es incorrecto', async () => {
    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'cliente-1'),
    ).rejects.toThrow(/No perteneces a esta barbería/);
  });

  it('permite al ADMINISTRADOR global sin vínculo: es transversal (D05)', async () => {
    prisma.usuarioRol.findFirst = vi.fn(async ({ where }: any) =>
      where.rol?.nombre === 'ADMINISTRADOR' ? { id: 'rol-admin' } : null,
    );

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud('sede-ajena'), 'admin-1'),
    ).resolves.toEqual([]);
  });
});

/**
 * P-SD-4 · sede suspendida: la disponibilidad deja de existir para una sede
 * `INACTIVO`.
 *
 * Antes el estado de la sede solo lo leía `vincularCliente`: una sede suspendida
 * seguía devolviendo huecos y el wizard seguía permitiendo reservar. Aquí se
 * fija que las tres puertas de lectura de disponibilidad lo rechazan con 422
 * `SEDE_INACTIVA` (D40), y que el rechazo NO se cuela antes de la pertenencia:
 * un cliente de otra sede no puede usar el 422 para sondear suspensiones.
 */
describe('DisponibilidadService · sede INACTIVO (P-SD-4)', () => {
  let service: DisponibilidadService;
  let prisma: any;

  /** Contrato D40: el cuerpo del error lleva `codigo`. */
  async function capturarError(promesa: Promise<unknown>) {
    try {
      await promesa;
    } catch (error: any) {
      const respuesta = typeof error?.getResponse === 'function' ? error.getResponse() : {};
      return {
        status: error?.getStatus?.() ?? respuesta.statusCode,
        codigo: respuesta.codigo,
        error,
      };
    }
    throw new Error('Se esperaba una excepción y la promesa se resolvió.');
  }

  beforeEach(() => {
    prisma = {
      // El mock separa la fila por qué se le pide: el estado solo se lee en la
      // guarda nueva, la zona en `datosDelDia`.
      barberia: {
        findUnique: vi.fn(async ({ select }: any) =>
          select?.estado ? { estado: 'INACTIVO' } : { zonaHoraria: 'America/Santo_Domingo' },
        ),
      },
      usuarioRol: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.rol?.nombre === 'ADMINISTRADOR' ? null : { id: 'rol-1' },
        ),
      },
      clienteBarberia: { findFirst: vi.fn(async () => ({ id: 'vinculo-1' })) },
      configuracionBarberia: { findUnique: vi.fn(async () => null) },
      horario: { findFirst: vi.fn(async () => null) },
      excepcionHorario: { findFirst: vi.fn(async () => null) },
    };
    service = new DisponibilidadService(prisma);
  });

  const solicitud = {
    barberiaId: 'sede-suspendida',
    fecha: '2026-10-05',
    duracionTotal: 30,
    margenRequerido: 0,
  };

  it('GET de disponibilidad sobre una sede INACTIVO responde 422 SEDE_INACTIVA', async () => {
    const { status, codigo, error } = await capturarError(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-1'),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
    expect(error).toBeInstanceOf(UnprocessableEntityException);
  });

  it('los huecos de una sede INACTIVO también se rechazan (no devuelven [])', async () => {
    const { status, codigo } = await capturarError(
      service.huecosDeLaSede('sede-suspendida', 'cliente-1', {
        fecha: '2026-10-05',
        duracionTotal: 30,
        participantes: 1,
      }),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
  });

  it('las alternativas de una sede INACTIVO también se rechazan', async () => {
    const { status, codigo } = await capturarError(
      service.buscarAlternativasDeSolicitante(
        { ...solicitud, duracionRequeridaMinutos: 30 },
        'cliente-1',
      ),
    );

    expect(status).toBe(422);
    expect(codigo).toBe('SEDE_INACTIVA');
  });

  it('la pertenencia sigue ganando: un cliente ajeno recibe 403, no 422', async () => {
    prisma.clienteBarberia.findFirst = vi.fn(async () => null);
    prisma.usuarioRol.findFirst = vi.fn(async () => null);

    const { status, codigo } = await capturarError(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-ajeno'),
    );

    expect(status).toBe(403);
    expect(codigo).toBeUndefined();
  });

  it('control: con la sede ACTIVO la lectura no cambia', async () => {
    prisma.barberia.findUnique = vi.fn(async ({ select }: any) =>
      select?.estado ? { estado: 'ACTIVO' } : { zonaHoraria: 'America/Santo_Domingo' },
    );

    await expect(
      service.calcularDisponibilidadDeSolicitante(solicitud, 'cliente-1'),
    ).resolves.toEqual([]);
  });
});

/**
 * Regla 4.3 · H69. La prioridad de `HorarioExcepcion` sobre `HorarioRegular` se
 * aplicaba en `datosDelDia` y nadie la vigilaba: cualquier refactor podía
 * devolver la rejilla del día festivo y el CI seguiría en verde.
 *
 * La regla tiene dos formas y las dos se fijan aquí:
 *  - `CERRADA` → el día no tiene jornada, diga lo que diga el horario base.
 *  - `HORARIO_ESPECIAL` → la jornada es la de la excepción, no la habitual.
 *
 * `2026-10-05` es lunes: el `horario` simulado es el turno regular de 09:00 a
 * 18:00 en la zona de la SEDE (`America/Santo_Domingo`, UTC-4), así que las
 * 09:00 locales son las 13:00 UTC.
 */
describe('DisponibilidadService · prioridad de las excepciones (regla 4.3 · H69)', () => {
  const tz = ZONA_POR_DEFECTO;
  const tiempo = new TiempoService();
  const FECHA = '2026-10-05';

  /** `TIME` tal como lo devuelve Prisma: 1970-01-01 en UTC con la hora tecleada. */
  function time(h: number, m: number): Date {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  const HORARIO_REGULAR = { horaInicio: time(9, 0), horaFin: time(18, 0) };

  function prismaCon(excepcion: any, horario: any = HORARIO_REGULAR) {
    return {
      barberia: { findUnique: async () => ({ zonaHoraria: tz }) },
      horario: { findFirst: async () => horario },
      // La excepción es de UNA fecha: se devuelve solo si se pide ese día.
      excepcionHorario: {
        findFirst: async ({ where }: any) =>
          where.fecha.getTime() === new Date(`${FECHA}T00:00:00Z`).getTime() ? excepcion : null,
      },
      bloqueosAgenda: { findMany: async () => [] },
      reserva: { findMany: async () => [] },
    } as any;
  }

  function servicioCon(excepcion: any, horario?: any) {
    return new DisponibilidadService(prismaCon(excepcion, horario));
  }

  const consulta = { barberiaId: 'sede', fecha: FECHA, duracionTotal: 30, margenRequerido: 0 };

  /** Etiquetas locales `HH:mm-HH:mm` de los huecos, para leer la aserción. */
  function etiquetas(slots: { inicio: Date; fin: Date }[]): string[] {
    return slots.map(
      (s) =>
        `${tiempo.desdeInstante(s.inicio, tz).hora}-${tiempo.desdeInstante(s.fin, tz).hora}`,
    );
  }

  it('control: sin excepción manda el horario regular (09:00–18:00 → 18 huecos)', async () => {
    const slots = await servicioCon(null).calcularDisponibilidad(consulta);

    expect(slots).toHaveLength(18);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['17:30-18:00']);
  });

  it('CERRADA borra la jornada aunque el horario regular diga que se abre', async () => {
    const slots = await servicioCon({
      tipo: 'CERRADA',
      horaInicio: null,
      horaFin: null,
    }).calcularDisponibilidad(consulta);

    expect(slots).toEqual([]);
  });

  it('HORARIO_ESPECIAL sustituye la rejilla: 10:00–12:00 y nada fuera de ahí', async () => {
    const slots = await servicioCon({
      tipo: 'HORARIO_ESPECIAL',
      horaInicio: time(10, 0),
      horaFin: time(12, 0),
    }).calcularDisponibilidad(consulta);

    expect(etiquetas(slots)).toEqual([
      '10:00-10:30',
      '10:30-11:00',
      '11:00-11:30',
      '11:30-12:00',
    ]);
    // Ni el 09:00 del horario base ni el 12:00 que la excepción recorta.
    expect(etiquetas(slots)).not.toContain('09:00-09:30');
    expect(etiquetas(slots)).not.toContain('12:00-12:30');
  });

  it('la excepción también recorta una jornada que empieza antes, en instantes reales', async () => {
    const slots = await servicioCon({
      tipo: 'HORARIO_ESPECIAL',
      horaInicio: time(10, 0),
      horaFin: time(12, 0),
    }).calcularDisponibilidad(consulta);

    // 10:00 locales en Santo Domingo (UTC-4) son 14:00 UTC.
    expect(slots[0].inicio.toISOString()).toBe('2026-10-05T14:00:00.000Z');
    expect(slots[slots.length - 1].fin.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('la excepción es de su día: al consultar otra fecha vuelve el horario regular', async () => {
    const service = servicioCon({
      tipo: 'CERRADA',
      horaInicio: null,
      horaFin: null,
    });

    const festivo = await service.calcularDisponibilidad(consulta);
    const diaSiguiente = await service.calcularDisponibilidad({
      ...consulta,
      fecha: '2026-10-06',
    });

    expect(festivo).toEqual([]);
    expect(diaSiguiente).toHaveLength(18);
  });
});
/**
 * V3 fase 5 · control de tiempo del barbero.
 *
 * La jornada de un día con `barberoId` es la INTERSECCIÓN del horario de la sede
 * con el del barbero, su descanso ocupa agenda y un día libre no devuelve
 * huecos. La retrocompatibilidad es explícita: un barbero sin ninguna fila en la
 * sede hereda el horario de la sede, para que el despliegue no vacíe agendas.
 *
 * `2026-10-05` es lunes (ISO 1) y la sede abre de 09:00 a 18:00 en
 * `America/Santo_Domingo`; con paso de 30 min son 18 huecos de 30 minutos.
 */
describe('DisponibilidadService · horario propio del barbero (V3 fase 5)', () => {
  const tz = ZONA_POR_DEFECTO;
  const tiempo = new TiempoService();
  const FECHA = '2026-10-05';
  const LUNES = 1;

  function time(h: number, m: number): Date {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  function fila(diaSemana: number, horas: Record<string, unknown> = {}) {
    return {
      diaSemana,
      esDiaLibre: false,
      horaInicio: time(9, 0),
      horaFin: time(18, 0),
      horaInicioDescanso: null,
      horaFinDescanso: null,
      ...horas,
    };
  }

  function prismaConBarbero(
    filas: any[],
    extra: { plantilla?: any; excepcionBarbero?: any } = {},
  ) {
    return {
      barberia: { findUnique: async () => ({ zonaHoraria: tz }) },
      horario: { findFirst: async () => ({ horaInicio: time(9, 0), horaFin: time(18, 0) }) },
      excepcionHorario: { findFirst: async () => null },
      // V3 · la excepción del BARBERO para esa fecha es la prioridad 1.
      excepcionHorarioBarbero: { findFirst: async () => extra.excepcionBarbero ?? null },
      horarioBarbero: { findMany: async () => filas },
      // V3 · plantilla base (prioridad 3): se resuelve por día ISO, así que un
      // mock con el día equivocado NO devuelve nada, igual que la base.
      horarioBaseBarbero: {
        findUnique: async ({ where }: any) =>
          extra.plantilla && where.barberoId_diaSemana.diaSemana === extra.plantilla.diaSemana
            ? extra.plantilla
            : null,
      },
      bloqueosAgenda: { findMany: async () => [] },
      reserva: { findMany: async () => [] },
    } as any;
  }

  const consulta = {
    barberiaId: 'sede',
    fecha: FECHA,
    duracionTotal: 30,
    margenRequerido: 0,
    barberoId: 'barbero-1',
  };

  function etiquetas(slots: { inicio: Date; fin: Date }[]): string[] {
    return slots.map(
      (s) =>
        `${tiempo.desdeInstante(s.inicio, tz).hora}-${tiempo.desdeInstante(s.fin, tz).hora}`,
    );
  }

  it('control: sin horario propio del barbero se hereda el de la sede', async () => {
    const slots = await new DisponibilidadService(prismaConBarbero([])).calcularDisponibilidad(
      consulta,
    );

    expect(slots).toHaveLength(18);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
  });

  it('un día libre no devuelve ningún hueco', async () => {
    const prisma = prismaConBarbero([
      fila(LUNES, { esDiaLibre: true, horaInicio: null, horaFin: null }),
    ]);

    await expect(
      new DisponibilidadService(prisma).calcularDisponibilidad(consulta),
    ).resolves.toEqual([]);
  });

  it('la jornada efectiva es la intersección: sede 09–18 y barbero 10–14', async () => {
    const prisma = prismaConBarbero([
      fila(LUNES, { horaInicio: time(10, 0), horaFin: time(14, 0) }),
    ]);

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta);

    expect(slots).toHaveLength(8);
    expect(etiquetas([slots[0]])).toEqual(['10:00-10:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['13:30-14:00']);
    expect(etiquetas(slots)).not.toContain('09:00-09:30');
    expect(etiquetas(slots)).not.toContain('14:00-14:30');
  });

  it('un barbero que entra antes que la sede no puede ampliarla: manda el rango más restrictivo', async () => {
    const prisma = prismaConBarbero([
      fila(LUNES, { horaInicio: time(7, 0), horaFin: time(20, 0) }),
    ]);

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta);

    expect(slots).toHaveLength(18);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['17:30-18:00']);
  });

  it('el descanso del barbero ocupa agenda: 12:00–13:00 queda sin huecos', async () => {
    const prisma = prismaConBarbero([
      fila(LUNES, { horaInicioDescanso: time(12, 0), horaFinDescanso: time(13, 0) }),
    ]);

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta);
    const horas = etiquetas(slots);

    expect(slots).toHaveLength(16);
    expect(horas).toContain('11:30-12:00');
    expect(horas).toContain('13:00-13:30');
    expect(horas).not.toContain('12:00-12:30');
    expect(horas).not.toContain('12:30-13:00');
  });

  it('un día sin fila en una semana ya configurada cuenta como libre', async () => {
    const prisma = prismaConBarbero([
      // Solo el martes está configurado; el lunes (día consultado) no.
      fila(2, { horaInicio: time(10, 0), horaFin: time(14, 0) }),
    ]);

    await expect(
      new DisponibilidadService(prisma).calcularDisponibilidad(consulta),
    ).resolves.toEqual([]);
  });

  it('las alternativas del error también respetan el descanso', async () => {
    const prisma = prismaConBarbero([
      fila(LUNES, { horaInicioDescanso: time(12, 0), horaFinDescanso: time(13, 0) }),
    ]);

    const alternativas = await new DisponibilidadService(prisma).buscarAlternativas({
      barberiaId: 'sede',
      fecha: FECHA,
      duracionRequeridaMinutos: 30,
      horaObjetivo: '12:30',
      barberoId: 'barbero-1',
      maximo: 3,
    });

    expect(alternativas.every((a) => a.horaInicio < '12:00' || a.horaInicio >= '13:00')).toBe(
      true,
    );
  });
});

/**
 * V3 · plantilla base semanal (`horarios_base_barbero`).
 *
 * El motor tenía dos fuentes de horario del barbero: la excepción de la fecha y
 * la semana declarada en `horarios_barbero`. Aquí se fija la tercera y, sobre
 * todo, la PRECEDENCIA entre las tres, que es lo que un refactor puede romper
 * sin que nada más se ponga rojo:
 *
 *   excepción del barbero  >  semana de la sede  >  plantilla base  >  sede
 *
 * `2026-10-05` es lunes (ISO 1) y la sede abre de 09:00 a 18:00 en
 * `America/Santo_Domingo`: con paso de 30 min son 18 huecos.
 */
describe('DisponibilidadService · plantilla base semanal del barbero (V3)', () => {
  const tz = ZONA_POR_DEFECTO;
  const tiempo = new TiempoService();
  const LUNES = '2026-10-05';
  const DOMINGO = '2026-10-04';

  function time(h: number, m: number): Date {
    const d = new Date('1970-01-01T00:00:00Z');
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  function fila(diaSemana: number, horas: Record<string, unknown> = {}) {
    return {
      diaSemana,
      esDiaLibre: false,
      horaInicio: time(9, 0),
      horaFin: time(18, 0),
      horaInicioDescanso: null,
      horaFinDescanso: null,
      ...horas,
    };
  }

  /** Fila de plantilla base: horas de texto, como las guarda la tabla. */
  function plantilla(diaSemana: number, inicio: string, fin: string, activo = true) {
    return { barberoId: 'barbero-1', diaSemana, horaInicio: inicio, horaFin: fin, activo };
  }

  function consulta(fecha = LUNES) {
    return {
      barberiaId: 'sede',
      fecha,
      duracionTotal: 30,
      margenRequerido: 0,
      barberoId: 'barbero-1',
    };
  }

  function etiquetas(slots: { inicio: Date; fin: Date }[]): string[] {
    return slots.map(
      (s) =>
        `${tiempo.desdeInstante(s.inicio, tz).hora}-${tiempo.desdeInstante(s.fin, tz).hora}`,
    );
  }

  /**
   * Prisma mínimo para el día del barbero: sede 09:00–18:00 y las tres fuentes
   * de horario propias que el motor debe ordenar por precedencia.
   */
  function prismaConBarbero(
    filas: any[],
    extra: { plantilla?: any; excepcionBarbero?: any } = {},
  ) {
    return {
      barberia: { findUnique: async () => ({ zonaHoraria: tz }) },
      horario: { findFirst: async () => ({ horaInicio: time(9, 0), horaFin: time(18, 0) }) },
      excepcionHorario: { findFirst: async () => null },
      excepcionHorarioBarbero: { findFirst: async () => extra.excepcionBarbero ?? null },
      horarioBarbero: { findMany: async () => filas },
      horarioBaseBarbero: {
        findUnique: async ({ where }: any) =>
          extra.plantilla && where.barberoId_diaSemana.diaSemana === extra.plantilla.diaSemana
            ? extra.plantilla
            : null,
      },
      bloqueosAgenda: { findMany: async () => [] },
      reserva: { findMany: async () => [] },
    } as any;
  }

  it('sin plantilla ni semana propia se sigue heredando el horario de la sede', async () => {
    const slots = await new DisponibilidadService(prismaConBarbero([])).calcularDisponibilidad(
      consulta(),
    );

    expect(slots).toHaveLength(18);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
  });

  it('la plantilla dicta la jornada cuando el barbero no declaró semana en la sede', async () => {
    const prisma = prismaConBarbero([], { plantilla: plantilla(1, '10:00', '14:00') });

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta());

    expect(slots).toHaveLength(8);
    expect(etiquetas([slots[0]])).toEqual(['10:00-10:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['13:30-14:00']);
  });

  it('la plantilla no puede ABRIR la sede: se recorta con ella', async () => {
    // La plantilla propone 07:00–20:00 y la sede abre 09:00–18:00.
    const prisma = prismaConBarbero([], { plantilla: plantilla(1, '07:00', '20:00') });

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta());

    expect(slots).toHaveLength(18);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['17:30-18:00']);
  });

  it('un día apagado en la plantilla deja al barbero sin huecos', async () => {
    const prisma = prismaConBarbero([], {
      plantilla: plantilla(1, '09:00', '18:00', false),
    });

    await expect(
      new DisponibilidadService(prisma).calcularDisponibilidad(consulta()),
    ).resolves.toEqual([]);
  });

  it('la semana declarada en la sede gana a la plantilla, aunque la plantilla esté activa', async () => {
    const prisma = prismaConBarbero([fila(1, { horaInicio: time(9, 0), horaFin: time(11, 0) })], {
      plantilla: plantilla(1, '10:00', '14:00'),
    });

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta());

    expect(slots).toHaveLength(4);
    expect(etiquetas([slots[0]])).toEqual(['09:00-09:30']);
    expect(etiquetas([slots[slots.length - 1]])).toEqual(['10:30-11:00']);
  });

  it('un día apagado en la plantilla NO apaga una semana ya declarada en la sede', async () => {
    const prisma = prismaConBarbero([fila(1)], {
      plantilla: plantilla(1, '09:00', '18:00', false),
    });

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta());

    expect(slots).toHaveLength(18);
  });

  it('la excepción del barbero manda sobre la plantilla: CERRADA borra el día', async () => {
    const prisma = prismaConBarbero([], {
      plantilla: plantilla(1, '09:00', '18:00'),
      excepcionBarbero: { tipo: 'CERRADA', horaInicio: null, horaFin: null },
    });

    await expect(
      new DisponibilidadService(prisma).calcularDisponibilidad(consulta()),
    ).resolves.toEqual([]);
  });

  it('la excepción del barbero sustituye la jornada de la plantilla', async () => {
    const prisma = prismaConBarbero([], {
      plantilla: plantilla(1, '09:00', '18:00'),
      excepcionBarbero: {
        tipo: 'HORARIO_ESPECIAL',
        horaInicio: time(11, 0),
        horaFin: time(13, 0),
      },
    });

    const slots = await new DisponibilidadService(prisma).calcularDisponibilidad(consulta());

    expect(etiquetas(slots)).toEqual([
      '11:00-11:30',
      '11:30-12:00',
      '12:00-12:30',
      '12:30-13:00',
    ]);
  });

  it('resuelve el día ISO de la fecha: el domingo busca el 7, no el 0', async () => {
    const prisma = prismaConBarbero([], { plantilla: plantilla(7, '10:00', '12:00') });
    const service = new DisponibilidadService(prisma);

    // 2026-10-04 es domingo. Con la numeración ISO la plantilla del 7 aplica...
    const domingo = await service.calcularDisponibilidad(consulta(DOMINGO));
    expect(etiquetas(domingo)).toEqual([
      '10:00-10:30',
      '10:30-11:00',
      '11:00-11:30',
      '11:30-12:00',
    ]);

    // ...y el lunes, con la misma plantilla cargada, sigue heredando la sede.
    const lunes = await service.calcularDisponibilidad(consulta());
    expect(lunes).toHaveLength(18);
  });
});
