import { reglaDeNegocio } from '../errors/d40.errors.js';

/**
 * E2-07 · P-SD-4: una sede SUSPENDIDA (`estado = INACTIVO`) no admite NUEVA
 * demanda.
 *
 * `PATCH /barberias/:id/estado` apaga la sede para todo el mundo, pero el
 * alta de reserva y los tres lectores de disponibilidad no miraban ese estado
 * (hallazgo del PLAN_MIGRACION_SOFT_DELETE §4): la hemorragia era que una sede
 * suspendida seguía vendiendo huecos. La regla vive en UN solo sitio para que
 * esos cuatro caminos no puedan divergir.
 *
 * `db` puede ser el cliente o un `tx`: la lectura participa de la misma
 * transacción que la operación que protege.
 *
 * Reserva lo que NO cambia (decisión tomada al ejecutar P-SD-4): las reservas
 * YA creadas siguen siendo operables por el staff —confirmar, rechazar,
 * cancelar, registrar asistencia— mientras la sede está suspendida; de lo
 * contrario quedarían huérfanas y sin camino de resolución. El bloqueo es de
 * NUEVA demanda, no de la que ya existe.
 *
 * Dos precisiones sobre los límites de la guarda:
 *
 *  - Dispara SOLO para `INACTIVO`, que es el valor suspendido del catálogo. La
 *    columna no admite nada más: `barberias_estado_check` (e203) fija
 *    `estado IN ('ACTIVO','INACTIVO')`, verificado contra `pg_constraint`, así
 *    que «distinto de ACTIVO» y «INACTIVO» son la misma condición en base.
 *  - Si la sede no existe, esta guarda calla: la existencia la exige quien
 *    necesita sus datos (configuración, horario, servicios), no el que solo
 *    pregunta si está suspendida.
 */
export async function exigirSedeActiva(db: any, barberiaId: string): Promise<void> {
  const barberia = await db.barberia.findUnique({
    where: { id: barberiaId },
    select: { estado: true },
  });

  if (barberia?.estado === 'INACTIVO') {
    throw reglaDeNegocio(
      'SEDE_INACTIVA',
      'La barbería está suspendida: no admite nuevas reservas ni la consulta de su disponibilidad.',
    );
  }
}
