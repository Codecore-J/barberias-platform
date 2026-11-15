/**
 * T-25 · SEED DE DEMOSTRACIÓN («entorno listo para operar»).
 *
 * Deja una sede con catálogo, personal, agenda de hoy y una caja con un cobro
 * completado, para poder enseñar el producto sin teclear datos a mano.
 *
 * ── Idempotencia ────────────────────────────────────────────────────────────
 * Se re-ejecuta sin duplicar y sin violar claves únicas, por tres mecanismos
 * distintos según lo que la tabla permita:
 *
 *  - `upsert` sobre una clave única natural (correo, `codigo_acceso`,
 *    `(barberia, nombre)` de categoría, `(barbero, categoría, nombre)` del
 *    servicio, `reserva_id` del pago, `(sede, barbero, día)` del horario).
 *  - ID DETERMINISTA para lo que no tiene clave natural: `reservas` y
 *    `participantes_reserva`. Un UUID fijo convierte «crear o actualizar» en un
 *    upsert real en vez de un `findFirst` a ciegas.
 *  - Lectura previa para lo que no tiene unicidad: los `horarios` de la sede se
 *    crean solo si la sede no tiene ninguno, en lugar de borrar y recrear.
 *
 * ── Atomicidad ──────────────────────────────────────────────────────────────
 * Todo se escribe dentro de UN `prisma.$transaction`: si un paso falla (un rol
 * que no existe, un CHECK de la base, un proveedor caído) no queda media demo
 * sembrada.
 *
 * ── Seguridad ───────────────────────────────────────────────────────────────
 * Guard E0-07: solo escribe con `APP_ENV=dev`; en cualquier otro entorno se
 * omite con un aviso y código de salida 0. Las cuentas nacen con el teléfono
 * verificado (si no, `authGuard` las manda a /auth/verify y el entorno demo no
 * se puede usar) y la contraseña es la de los botones demo del login, que ya
 * viaja en el bundle del cliente: `DEMO_USERS_PASSWORD` permite cambiarla sin
 * tocar código. Nada de esto puede ejecutarse contra producción.
 *
 * Ejecutar: `npm run prisma:seed:demo`, o `npx prisma db seed` —que encadena el
 * seed estructural y este— (lee `.env` si hace falta).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

// Sin `APP_ENV` en el proceso, el guard de abajo abortaría en un `.env` que sí lo
// declara. Prisma carga `DATABASE_URL` por su cuenta; esto cubre el resto.
if (!process.env.APP_ENV && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // `.env` ilegible: el guard da el mensaje definitivo.
  }
}

/** La misma que rellenan los botones «ACCESO RÁPIDO DEMO» del login. */
const PASSWORD_POR_DEFECTO = 'Password123!';
const PASSWORD = process.env.DEMO_USERS_PASSWORD ?? PASSWORD_POR_DEFECTO;
if (!process.env.DEMO_USERS_PASSWORD) {
  console.warn('⚠️  DEMO_USERS_PASSWORD no definida: se usa la del botón demo del login.');
}

const prisma = new PrismaClient();

/** Sede compartida con `seed-demo-users.ts`: la demo se apoya en la MISMA sede. */
const CODIGO_ACCESO = 'DEMO2026';
const ENLACE_UNICO = 'imperial-barbers-demo';

/**
 * IDs deterministas de la agenda. `reservas` no tiene clave natural —dos citas
 * del mismo cliente a la misma hora serían filas distintas— y sin embargo el
 * seed tiene que actualizar «la cita demo de las 10:00» y no acumular una nueva
 * cada ejecución. Un UUID fijo es la clave natural que la tabla no declara.
 */
const IDS = {
  reservaCompletada: 'd25e0000-0000-4000-8000-000000000001',
  participanteCompletada: 'd25e0000-0000-4000-8000-000000000011',
  reservaProxima: 'd25e0000-0000-4000-8000-000000000002',
  participanteProxima: 'd25e0000-0000-4000-8000-000000000021',
} as const;

/** Catálogo: dos categorías lógicas con precios y duraciones de barbería real. */
const CATEGORIAS = [
  {
    nombre: 'Cortes de Cabello',
    descripcion: 'Corte a tijera, máquina y degradados.',
    servicios: [
      { nombre: 'Corte Clásico', precio: 350, duracion: 30 },
      { nombre: 'Degradado / Fade', precio: 450, duracion: 45 },
    ],
  },
  {
    nombre: 'Barba y Cuidado',
    descripcion: 'Perfilado, afeitado con navaja y ritual de toalla caliente.',
    servicios: [
      { nombre: 'Aperfilar Barba', precio: 250, duracion: 20 },
      { nombre: 'Afeitado con Navaja', precio: 300, duracion: 30 },
    ],
  },
] as const;

/** Lunes a sábado (ISO 1–7, igual que el resto del motor); domingo cerrado. */
const DIAS_LABORABLES = [1, 2, 3, 4, 5, 6] as const;

const HORARIO_SEDE = { apertura: [9, 0], cierre: [19, 0] } as const;

/**
 * Hora de reloj para columnas `@db.Time`.
 *
 * Prisma serializa un `Date` en UTC y PostgreSQL se queda con la porción de
 * hora, así que la fecha se construye también en UTC: así las 10:00 escritas
 * son las 10:00 que lee la agenda, sin que la zona del portátil que ejecuta el
 * seed desplace la cita una hora.
 */
function horaDeReloj(hora: number, minuto: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hora, minuto, 0, 0));
}

/**
 * Etiqueta de calendario de HOY para `@db.Date`, en la zona del equipo: la
 * demo es para quien la ejecuta, no para la zona de la sede.
 */
function fechaDeHoy(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}

/** Cliente de transacción: el mismo tipo que recibe el callback de `$transaction`. */
type Tx = Prisma.TransactionClient;

/**
 * Usuario idempotente por correo.
 *
 * El `update` no es cosmético: re-ejecutar el seed tiene que dejar la cuenta en
 * el estado que la demo necesita (ACTIVA y con el teléfono verificado) aunque
 * alguien la haya suspendido probando la pantalla de administración.
 */
async function upsertUsuario(
  tx: Tx,
  datos: { correo: string; nombreCompleto: string; telefono: string; passwordHash: string },
) {
  return tx.usuario.upsert({
    where: { correo: datos.correo },
    update: {
      nombreCompleto: datos.nombreCompleto,
      telefono: datos.telefono,
      passwordHash: datos.passwordHash,
      estadoCuenta: 'ACTIVO',
      telefonoVerificado: true,
    },
    create: {
      ...datos,
      estadoCuenta: 'ACTIVO',
      telefonoVerificado: true,
    },
  });
}

/**
 * Rol de la cuenta. Se borra y se vuelve a crear la asignación del PAR
 * (usuario, rol) porque los roles globales viven en filas con
 * `barberia_id = NULL` y el índice único parcial de PostgreSQL no cubre ese caso
 * desde Prisma: sin el `deleteMany`, cada ejecución podría duplicar la fila.
 */
async function asignarRol(
  tx: Tx,
  usuarioId: string,
  rolId: string,
  barberiaId: string | null,
): Promise<void> {
  await tx.usuarioRol.deleteMany({ where: { usuarioId, rolId } });
  await tx.usuarioRol.create({ data: { usuarioId, rolId, barberiaId } });
}

/** Lo que la demo deja sembrado, para que el llamador pueda informarlo. */
export interface ResumenDemo {
  barberia: string;
  barberiaId: string;
  barberos: string[];
  cliente: string;
  categorias: number;
  servicios: number;
  citas: number;
  cobros: number;
}

/**
 * Siembra la demo completa.
 *
 * Se exporta porque `npx prisma db seed` (→ `prisma/seed.ts`) la llama en el
 * MISMO proceso: el runner de Prisma no interpreta `&&`, así que encadenar dos
 * scripts en `prisma.seed` ejecutaba solo el primero y pasaba el resto como
 * argumentos. Un único comando con dos funciones es lo único que funciona igual
 * en Windows, Linux y CI.
 *
 * Guard E0-07 dentro de la función, no en el módulo: importada desde `seed.ts`,
 * un `process.exit` a nivel de módulo abortaría también el seed estructural.
 * Fuera de `APP_ENV=dev` devuelve `null` sin escribir nada.
 */
export async function sembrarDemo(
  cliente: PrismaClient = prisma,
): Promise<ResumenDemo | null> {
  if (process.env.APP_ENV !== 'dev') {
    console.warn(
      '⏭️  Seed de demo OMITIDO (E0-07): requiere APP_ENV=dev. No se ha escrito nada.',
    );
    return null;
  }

  console.log('🌱 Seed de DEMO (T-25): catálogo, personal, agenda de hoy y caja...');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const hoy = fechaDeHoy();

  const resumen: ResumenDemo = await cliente.$transaction(
    async (tx) => {
      // ── 0. Catálogos base ──────────────────────────────────────────────────
      // Los roles y permisos son del seed estructural (`npm run seed`). Aquí no
      // se crean: se exigen, con un mensaje que dice qué hacer si faltan.
      const nombres = ['CLIENTE', 'BARBERO', 'ADMIN_BARBERIA', 'ADMINISTRADOR'] as const;
      const roles = await tx.rol.findMany({ where: { nombre: { in: [...nombres] } } });
      const rolPorNombre = new Map(roles.map((rol) => [rol.nombre, rol]));
      const faltantes = nombres.filter((nombre) => !rolPorNombre.has(nombre));

      if (faltantes.length > 0) {
        throw new Error(
          `Faltan roles en la base (${faltantes.join(', ')}). Ejecuta primero «npm run seed».`,
        );
      }

      const rol = (nombre: (typeof nombres)[number]): string => rolPorNombre.get(nombre)!.id;

      // ── 1. Cuentas ─────────────────────────────────────────────────────────
      const admin = await upsertUsuario(tx, {
        correo: 'admin@demo.com',
        nombreCompleto: 'Admin Demo',
        telefono: '3000000001',
        passwordHash,
      });
      const barbero1 = await upsertUsuario(tx, {
        correo: 'barbero@demo.com',
        nombreCompleto: 'Luis Medina',
        telefono: '3000000002',
        passwordHash,
      });
      const barbero2 = await upsertUsuario(tx, {
        correo: 'barbero2@demo.com',
        nombreCompleto: 'Rafael Ortiz',
        telefono: '3000000004',
        passwordHash,
      });
      const cliente = await upsertUsuario(tx, {
        correo: 'cliente@demo.com',
        nombreCompleto: 'Cliente Demo',
        telefono: '3000000003',
        passwordHash,
      });

      // ── 2. Sede ────────────────────────────────────────────────────────────
      // Upsert por `codigoAcceso`: es la llave que ya usa `seed-demo-users.ts`,
      // así que ejecutar los dos seeds sobre la misma base deja UNA sede.
      const barberia = await tx.barberia.upsert({
        where: { codigoAcceso: CODIGO_ACCESO },
        update: {
          nombre: 'Imperial Barbers Demo',
          telefono: '3000000000',
          responsableId: admin.id,
          estado: 'ACTIVO',
        },
        create: {
          nombre: 'Imperial Barbers Demo',
          descripcion: 'Sede de demostración lista para operar (T-25)',
          telefono: '3000000000',
          ubicacion: 'Calle Demo 123, Ciudad',
          codigoAcceso: CODIGO_ACCESO,
          enlaceUnico: ENLACE_UNICO,
          responsableId: admin.id,
        },
      });

      // El ADMINISTRADOR global no necesita sede para operar, pero la demo se
      // enseña desde la consola de la sede: sin ADMIN_BARBERIA la agenda, la
      // caja y el catálogo responden 403 y el entorno no está «listo».
      await asignarRol(tx, admin.id, rol('ADMINISTRADOR'), null);
      await asignarRol(tx, admin.id, rol('ADMIN_BARBERIA'), barberia.id);

      await asignarRol(tx, barbero1.id, rol('CLIENTE'), null);
      await asignarRol(tx, barbero1.id, rol('BARBERO'), barberia.id);
      await asignarRol(tx, barbero2.id, rol('CLIENTE'), null);
      await asignarRol(tx, barbero2.id, rol('BARBERO'), barberia.id);
      await asignarRol(tx, cliente.id, rol('CLIENTE'), null);

      // Vínculo del cliente con la sede: sin él el catálogo de la sede y la
      // creación de reservas le responden que no pertenece.
      await tx.clienteBarberia.upsert({
        where: { uk_cliente_barberia: { usuarioId: cliente.id, barberiaId: barberia.id } },
        update: { estadoVinculacion: 'ACTIVO', esBarberiaActiva: true },
        create: {
          usuarioId: cliente.id,
          barberiaId: barberia.id,
          estadoVinculacion: 'ACTIVO',
          esBarberiaActiva: true,
        },
      });

      // ── 3. Catálogo (categorías + servicios por barbero) ───────────────────
      // El catálogo es híbrido: la categoría es de la sede y el precio/duración
      // son del barbero. Por eso cada servicio se siembra para CADA barbero.
      const serviciosPorNombre = new Map<string, string>();
      const barberos = [barbero1, barbero2];

      for (const categoriaDemo of CATEGORIAS) {
        const categoria = await tx.categoriaServicio.upsert({
          where: {
            uk_categoria_sede_nombre: { barberiaId: barberia.id, nombre: categoriaDemo.nombre },
          },
          update: { descripcion: categoriaDemo.descripcion, activa: true },
          create: {
            barberiaId: barberia.id,
            nombre: categoriaDemo.nombre,
            descripcion: categoriaDemo.descripcion,
          },
        });

        for (const servicio of categoriaDemo.servicios) {
          for (const barbero of barberos) {
            const fila = await tx.servicioBarbero.upsert({
              where: {
                uk_servicio_barbero_categoria_nombre: {
                  barberoId: barbero.id,
                  categoriaId: categoria.id,
                  nombrePersonalizado: servicio.nombre,
                },
              },
              update: {
                precio: servicio.precio,
                duracionMinutos: servicio.duracion,
                activo: true,
              },
              create: {
                barberoId: barbero.id,
                categoriaId: categoria.id,
                nombrePersonalizado: servicio.nombre,
                precio: servicio.precio,
                duracionMinutos: servicio.duracion,
              },
            });

            // La cita demo cobra el servicio del PRIMER barbero; se guarda el id
            // de ese para congelarlo en el snapshot de la reserva.
            if (barbero.id === barbero1.id) {
              serviciosPorNombre.set(servicio.nombre, fila.id);
            }
          }
        }
      }

      const corteClasico = serviciosPorNombre.get('Corte Clásico');
      const degradado = serviciosPorNombre.get('Degradado / Fade');
      if (!corteClasico || !degradado) {
        throw new Error('El catálogo demo no generó los servicios esperados.');
      }

      // ── 4. Configuración, horarios y disponibilidad ────────────────────────
      // Sin configuración la sede no expone su modo de reserva; con los
      // defaults del esquema basta para operar.
      await tx.configuracionBarberia.upsert({
        where: { barberiaId: barberia.id },
        update: {},
        create: { barberiaId: barberia.id },
      });

      const horariosSede = await tx.horario.count({ where: { barberiaId: barberia.id } });
      if (horariosSede === 0) {
        await tx.horario.createMany({
          data: DIAS_LABORABLES.map((diaSemana) => ({
            barberiaId: barberia.id,
            diaSemana,
            horaInicio: horaDeReloj(...HORARIO_SEDE.apertura),
            horaFin: horaDeReloj(...HORARIO_SEDE.cierre),
          })),
        });
      } else {
        console.log(`ℹ️  La sede ya tenía ${horariosSede} horarios; no se tocan.`);
      }

      // Horario del barbero: interseca con el de la sede y deja el domingo libre.
      for (const barbero of barberos) {
        for (let diaSemana = 1; diaSemana <= 7; diaSemana++) {
          // ISO 1 = lunes … 6 = sábado abiertos; 7 = domingo cerrado.
          const esDiaLibre = diaSemana === 7;
          const datos = {
            horaInicio: esDiaLibre ? null : horaDeReloj(...HORARIO_SEDE.apertura),
            horaFin: esDiaLibre ? null : horaDeReloj(...HORARIO_SEDE.cierre),
            horaInicioDescanso: esDiaLibre ? null : horaDeReloj(13, 0),
            horaFinDescanso: esDiaLibre ? null : horaDeReloj(14, 0),
            esDiaLibre,
          };

          await tx.horarioBarbero.upsert({
            where: {
              uk_horario_barbero_dia: {
                barberiaId: barberia.id,
                barberoId: barbero.id,
                diaSemana,
              },
            },
            update: datos,
            create: { barberiaId: barberia.id, barberoId: barbero.id, diaSemana, ...datos },
          });
        }
      }

      // ── 5. Agenda de hoy ──────────────────────────────────────────────────
      // Cita 1: ya prestada y cobrada (llena la caja del día).
      const reservaCompletada = await tx.reserva.upsert({
        where: { id: IDS.reservaCompletada },
        update: {
          fechaCita: hoy,
          barberoId: barbero1.id,
          estado: 'COMPLETADA',
          totalPagar: 350,
        },
        create: {
          id: IDS.reservaCompletada,
          barberiaId: barberia.id,
          clienteId: cliente.id,
          barberoId: barbero1.id,
          tipoReserva: 'INDIVIDUAL',
          estado: 'COMPLETADA',
          modoConfirmacion: 'AUTOMATICA',
          fechaCita: hoy,
          horaInicio: horaDeReloj(10, 0),
          horaFin: horaDeReloj(10, 30),
          totalPagar: 350,
          completadaAt: new Date(),
        },
      });

      // Cita 2: la que el recepcionista ve llegar en la agenda de hoy.
      const reservaProxima = await tx.reserva.upsert({
        where: { id: IDS.reservaProxima },
        update: { fechaCita: hoy, barberoId: barbero2.id, estado: 'CONFIRMADA', totalPagar: 450 },
        create: {
          id: IDS.reservaProxima,
          barberiaId: barberia.id,
          clienteId: cliente.id,
          barberoId: barbero2.id,
          tipoReserva: 'INDIVIDUAL',
          estado: 'CONFIRMADA',
          modoConfirmacion: 'AUTOMATICA',
          fechaCita: hoy,
          horaInicio: horaDeReloj(16, 0),
          horaFin: horaDeReloj(16, 45),
          totalPagar: 450,
        },
      });

      /**
       * Participante + snapshot del servicio.
       *
       * El snapshot (`precio_historico`, `duracion_historica`) es lo que pinta
       * la agenda y lo que cobra la caja: la reserva no depende de que el
       * barbero no cambie el precio después.
       */
      const sembrarParticipante = async (
        reservaId: string,
        participanteId: string,
        servicio: { id: string; nombre: string; precio: number; duracion: number },
      ) => {
        await tx.participanteReserva.upsert({
          where: { id: participanteId },
          update: { reservaId, nombreParticipante: cliente.nombreCompleto },
          create: {
            id: participanteId,
            reservaId,
            esAdultoResponsable: true,
            nombreParticipante: cliente.nombreCompleto,
          },
        });

        // `participante_servicios` no tiene clave única y su CHECK exige
        // exactamente uno de los dos servicios: se reemplaza el snapshot del
        // participante para no acumular filas en cada ejecución.
        await tx.participanteServicio.deleteMany({ where: { participanteId } });
        await tx.participanteServicio.create({
          data: {
            participanteId,
            servicioBarberoId: servicio.id,
            precioHistorico: servicio.precio,
            duracionHistorica: servicio.duracion,
            margenHistorico: 0,
          },
        });
      };

      await sembrarParticipante(reservaCompletada.id, IDS.participanteCompletada, {
        id: corteClasico,
        nombre: 'Corte Clásico',
        precio: 350,
        duracion: 30,
      });
      await sembrarParticipante(reservaProxima.id, IDS.participanteProxima, {
        id: degradado,
        nombre: 'Degradado / Fade',
        precio: 450,
        duracion: 45,
      });

      // ── 6. Cobro de la cita completada ────────────────────────────────────
      // Mismo estado que escribe `PagoService` al cobrar (`PAGADA`, sede copiada
      // de la reserva, método del catálogo), para que el arqueo del día y el
      // historial de cobros lo traten como una venta real y no como un adorno.
      await tx.pago.upsert({
        where: { reservaId: reservaCompletada.id },
        update: {
          barberiaId: barberia.id,
          estadoPago: 'PAGADA',
          monto: 350,
          metodoPago: 'EFECTIVO',
          registradoPor: barbero1.id,
          registradoAt: new Date(),
          actualizadoAt: new Date(),
          anuladoAt: null,
          anuladoPor: null,
          motivoAnulacion: null,
        },
        create: {
          reservaId: reservaCompletada.id,
          barberiaId: barberia.id,
          estadoPago: 'PAGADA',
          monto: 350,
          metodoPago: 'EFECTIVO',
          registradoPor: barbero1.id,
        },
      });

      return {
        barberia: barberia.nombre,
        barberiaId: barberia.id,
        barberos: [barbero1.correo, barbero2.correo],
        cliente: cliente.correo,
        categorias: CATEGORIAS.length,
        servicios: CATEGORIAS.reduce((total, c) => total + c.servicios.length, 0) * barberos.length,
        citas: 2,
        cobros: 1,
      };
    },
    // El seed hace decenas de upserts en serie; el timeout por defecto de 5 s
    // de Prisma es corto para una base remota lenta.
    { timeout: 30_000, maxWait: 15_000 },
  );

  console.log('✅ Sede:', resumen.barberia, `(${resumen.barberiaId})`);
  console.log(`✅ Catálogo: ${resumen.categorias} categorías, ${resumen.servicios} servicios.`);
  console.log(`✅ Personal: ${resumen.barberos.join(', ')} vinculados como BARBERO.`);
  console.log(`✅ Agenda de hoy: ${resumen.citas} citas (1 completada y cobrada, 1 confirmada).`);
  console.log(`✅ Caja: ${resumen.cobros} cobro PAGADA en EFECTIVO.`);
  console.log(`✅ Cliente demo: ${resumen.cliente}`);
  console.log('🎉 Entorno de demo listo. Login: admin@demo.com / barbero@demo.com / cliente@demo.com');

  return resumen;
}

/**
 * CLI propio (`npm run prisma:seed:demo`).
 *
 * La comparación por nombre de archivo evita que importar este módulo desde
 * `seed.ts` dispare una segunda siembra: solo ejecuta cuando tsx arrancó ESTE
 * archivo.
 */
if (basename(process.argv[1] ?? '') === 'seed-demo.ts') {
  sembrarDemo()
    .catch((error) => {
      console.error('❌ Error durante el seed de demo:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
