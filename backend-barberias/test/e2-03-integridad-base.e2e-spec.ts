/**
 * E2-03 · Integridad base: los CHECK de catálogo cierran la puerta del esquema.
 *
 * Prueba de INTEGRACIÓN (va contra la base, no contra la API): intenta saltarse
 * el backend e insertar por SQL directo un estado fuera de catálogo. Con la
 * migración `e203_integridad_base` la base debe RECHAZARLO; sin ella lo acepta.
 *
 * Cada INSERT corre dentro de una transacción que SIEMPRE revierte, así que la
 * prueba no escribe datos. El patrón `MARCA` distingue los dos casos:
 *   - la base rechaza la fila  → el error de Postgres llega antes de la marca;
 *   - la base acepta la fila   → llegamos al `throw` de la marca (y revertimos).
 *
 * Los argumentos son funciones (`args`): se resuelven cuando corre el test, es
 * decir después de `beforeAll`, que es cuando existen los ids reales.
 *
 * Solo con APP_ENV=dev: `test/setup.e2e.ts` aborta en cualquier otro entorno.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MARCA_ROLLBACK = 'E203_ROLLBACK';

async function intentarInsertar(sql: string, args: unknown[] = []): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql, ...args);
      throw new Error(MARCA_ROLLBACK);
    });
    return 'SIN_ERROR';
  } catch (e) {
    return (e as Error).message;
  }
}

/** Un rechazo por CHECK (SQLSTATE 23514): NO llegó a la marca de rollback. */
const esRechazoDeCheck = (msg: string) =>
  !msg.includes(MARCA_ROLLBACK) && /23514|check constraint|_check/i.test(msg);

let barberiaId = '';
let usuarioId = '';
let usuarioSinVinculoId = '';
let sufijo = '';

beforeAll(async () => {
  sufijo = Date.now().toString(36);

  const barberia = await prisma.barberia.findFirst({ select: { id: true } });
  const usuario = await prisma.usuario.findFirst({ select: { id: true } });
  if (!barberia || !usuario) {
    throw new Error('E2-03: la base dev no tiene barbería/usuario para la prueba.');
  }
  barberiaId = barberia.id;
  usuarioId = usuario.id;

  // Un usuario SIN vínculo con esta barbería, para que el INSERT de
  // `cliente_barberias` choque contra el CHECK y no contra el único.
  const candidato = await prisma.usuario.findFirst({
    where: { clienteBarberias: { none: { barberiaId } } },
    select: { id: true },
  });
  if (!candidato) {
    throw new Error('E2-03: no hay un usuario sin vínculo para la prueba.');
  }
  usuarioSinVinculoId = candidato.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Forma válida del INSERT de reservas; solo cambia la columna bajo prueba. */
const reserva = (estado: string, tipo: string, modo: string) => ({
  sql: `INSERT INTO "reservas"
          ("barberia_id","cliente_id","tipo_reserva","estado","modo_confirmacion",
           "fecha_cita","hora_inicio","hora_fin","total_pagar")
        VALUES ($1::uuid,$2::uuid,$3,$4,$5, CURRENT_DATE, TIME '10:00', TIME '10:30', 0)`,
  args: () => [barberiaId, usuarioId, tipo, estado, modo],
});

const casos: { nombre: string; sql: string; args: () => unknown[] }[] = [
  {
    nombre: 'barberias.estado = ACTIVA (variante histórica fuera de catálogo)',
    sql: `INSERT INTO "barberias"
            ("nombre","telefono","ubicacion","codigo_acceso","enlace_unico","responsable_id","estado")
          VALUES ($1,$2,$3,$4,$5,$6::uuid,'ACTIVA')`,
    args: () => [
      `E203 ${sufijo}`,
      '0000000000',
      'x',
      `e203-act-${sufijo}`,
      `e203-act-link-${sufijo}`,
      usuarioId,
    ],
  },
  {
    nombre: 'barberias.zona_horaria fuera del catálogo D15',
    sql: `INSERT INTO "barberias"
            ("nombre","telefono","ubicacion","codigo_acceso","enlace_unico","responsable_id","zona_horaria")
          VALUES ($1,$2,$3,$4,$5,$6::uuid,'Europe/Madrid')`,
    args: () => [
      `E203 tz ${sufijo}`,
      '0000000001',
      'x',
      `e203-tz-${sufijo}`,
      `e203-tz-link-${sufijo}`,
      usuarioId,
    ],
  },
  {
    nombre: 'reservas.estado = NO_ASISTIO (valor retirado en E2-02)',
    ...reserva('NO_ASISTIO', 'INDIVIDUAL', 'MANUAL'),
  },
  {
    nombre: 'reservas.estado fuera de los 8 de §5.1',
    ...reserva('EN_CURSO', 'INDIVIDUAL', 'MANUAL'),
  },
  {
    nombre: 'reservas.tipo_reserva fuera de catálogo',
    ...reserva('PENDIENTE', 'MAYORITARIA', 'MANUAL'),
  },
  {
    nombre: 'reservas.modo_confirmacion fuera de catálogo',
    ...reserva('PENDIENTE', 'INDIVIDUAL', 'AUTOMATICO'),
  },
  {
    nombre: 'usuarios.estado_cuenta fuera de D09',
    sql: `INSERT INTO "usuarios"
            ("nombre_completo","correo","telefono","password_hash","estado_cuenta")
          VALUES ($1,$2,$3,'x','INACTIVO')`,
    args: () => ['E203 Usuario', `e203-${sufijo}@test.local`, `e203-${sufijo}`],
  },
  {
    nombre: 'cliente_barberias.estado_vinculacion fuera de D10',
    sql: `INSERT INTO "cliente_barberias" ("usuario_id","barberia_id","estado_vinculacion")
          VALUES ($1::uuid,$2::uuid,'SUSPENDIDO')`,
    args: () => [usuarioSinVinculoId, barberiaId],
  },
  {
    nombre: 'pagos.estado_pago fuera de catálogo',
    sql: `WITH r AS (
            INSERT INTO "reservas"
              ("barberia_id","cliente_id","tipo_reserva","estado","modo_confirmacion",
               "fecha_cita","hora_inicio","hora_fin","total_pagar")
            VALUES ($1::uuid,$2::uuid,'INDIVIDUAL','CONFIRMADA','MANUAL', CURRENT_DATE, TIME '11:00', TIME '11:30', 0)
            RETURNING "id"
          )
          INSERT INTO "pagos" ("reserva_id","estado_pago","monto")
          SELECT "id", 'PAGADO', 0 FROM r`,
    args: () => [barberiaId, usuarioId],
  },
  {
    nombre: 'antecedentes.origen fuera de catálogo',
    sql: `INSERT INTO "antecedentes" ("usuario_id","categoria","contenido","origen")
          VALUES ($1::uuid,'E203','x','SISTEMA')`,
    args: () => [usuarioId],
  },
  {
    nombre: 'antecedentes.estado_validacion fuera de catálogo',
    sql: `INSERT INTO "antecedentes" ("usuario_id","categoria","contenido","estado_validacion")
          VALUES ($1::uuid,'E203','x','VALIDA')`,
    args: () => [usuarioId],
  },
  {
    nombre: 'notificaciones.canal fuera de catálogo',
    sql: `INSERT INTO "notificaciones" ("usuario_id","canal","tipo")
          VALUES ($1::uuid,'TELEGRAM','E203')`,
    args: () => [usuarioId],
  },
  {
    nombre: 'notificaciones.estado fuera de catálogo',
    sql: `INSERT INTO "notificaciones" ("usuario_id","canal","tipo","estado")
          VALUES ($1::uuid,'EMAIL','E203','SIMULADO')`,
    args: () => [usuarioId],
  },
  {
    nombre: 'roles.ambito fuera de catálogo',
    sql: `INSERT INTO "roles" ("nombre","ambito") VALUES ($1,'SUPERADMIN')`,
    args: () => [`E203_ROL_${sufijo}`],
  },
  {
    nombre: 'excepciones_horario.tipo fuera de catálogo',
    sql: `INSERT INTO "excepciones_horario" ("barberia_id","fecha","tipo")
          VALUES ($1::uuid, DATE '2099-12-31', 'FERIADO')`,
    args: () => [barberiaId],
  },
  {
    nombre: 'excepciones_horario_barbero.tipo fuera de catálogo',
    sql: `INSERT INTO "excepciones_horario_barbero" ("barberia_id","barbero_id","fecha","tipo")
          VALUES ($1::uuid,$2::uuid, DATE '2099-12-30', 'FERIADO')`,
    args: () => [barberiaId, usuarioId],
  },
];

describe('E2-03 · la base rechaza estados fuera de catálogo por SQL directo', () => {
  it.each(casos)('rechaza $nombre', async ({ sql, args }) => {
    const msg = await intentarInsertar(sql, args());

    // Si la base hubiera aceptado la fila habríamos llegado a la marca.
    expect(msg, `la base ACEPTÓ el valor inválido: ${msg}`).not.toContain(MARCA_ROLLBACK);
    expect(esRechazoDeCheck(msg), `error inesperado: ${msg}`).toBe(true);
  });

  it('control: un valor válido SÍ entra (el rechazo es por el CHECK, no por otra causa)', async () => {
    const msg = await intentarInsertar(
      `INSERT INTO "roles" ("nombre","ambito") VALUES ($1,'BARBERIA')`,
      [`E203_CTRL_${sufijo}`],
    );
    expect(msg).toContain(MARCA_ROLLBACK);
  });

  it('control: la forma del INSERT de reservas es válida con un estado del catálogo', async () => {
    const { sql, args } = reserva('PENDIENTE', 'INDIVIDUAL', 'MANUAL');
    const msg = await intentarInsertar(sql, args());
    expect(msg).toContain(MARCA_ROLLBACK);
  });
});
