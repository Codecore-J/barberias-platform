import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

/**
 * Seed acotado para validar las bandejas de solicitudes de cambio y clientes
 * restringidos en navegador. Es aditivo e idempotente: nunca resetea estados
 * resueltos ni reactiva restricciones si se vuelve a ejecutar.
 */
const APP_ENV = process.env.APP_ENV;
if (APP_ENV !== 'dev') {
  throw new Error('ABORTADO: seed:bandejas solo puede ejecutarse con APP_ENV=dev.');
}

const RUN_ID = '20261102-v1';
const SEED_MARKER = `QA-BANDEJAS-${RUN_ID}`;
const prisma = new PrismaClient();

async function telefonoDisponible(correo: string, base: string): Promise<string> {
  const usuarioExistente = await prisma.usuario.findUnique({ where: { correo } });
  if (usuarioExistente) return usuarioExistente.telefono;

  for (let intento = 0; intento < 100; intento++) {
    const telefono = `${base}${String(intento).padStart(2, '0')}`;
    const ocupado = await prisma.usuario.findUnique({ where: { telefono } });
    if (!ocupado) return telefono;
  }

  throw new Error(`No se encontró un teléfono de prueba disponible para ${correo}.`);
}

async function obtenerOCrearUsuarioPrueba(
  correo: string,
  nombreCompleto: string,
  baseTelefono: string,
): Promise<{ id: string }> {
  const existente = await prisma.usuario.findUnique({ where: { correo } });
  if (existente) return existente;

  const telefono = await telefonoDisponible(correo, baseTelefono);
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  return prisma.usuario.create({
    data: { correo, nombreCompleto, telefono, passwordHash },
  });
}

async function main(): Promise<void> {
  const rolAdmin = await prisma.rol.findUnique({ where: { nombre: 'ADMINISTRADOR' } });
  if (!rolAdmin || rolAdmin.ambito !== 'GLOBAL') {
    throw new Error('No existe el rol global ADMINISTRADOR; seed cancelado.');
  }

  const asignacionAdmin = await prisma.usuarioRol.findFirst({
    where: { rolId: rolAdmin.id, barberiaId: null },
    include: { usuario: true },
  });
  if (!asignacionAdmin || asignacionAdmin.usuario.estadoCuenta !== 'ACTIVO') {
    throw new Error('No se encontró un ADMINISTRADOR global activo para la sede QA.');
  }

  const codigoAcceso = SEED_MARKER;
  const barberia = await prisma.barberia.upsert({
    where: { codigoAcceso },
    update: {},
    create: {
      nombre: `QA Bandejas ${RUN_ID}`,
      descripcion: 'Sede sintética para validación E2E de bandejas administrativas.',
      telefono: '8090000000',
      ubicacion: 'Entorno QA, datos sintéticos',
      codigoAcceso,
      enlaceUnico: `qa-bandejas-${RUN_ID}`,
      responsableId: asignacionAdmin.usuarioId,
    },
  });

  const cliente = await obtenerOCrearUsuarioPrueba(
    `qa.bandejas.cliente.${RUN_ID}@example.invalid`,
    'Cliente QA Bandejas',
    '829900100',
  );
  const propuesto = await obtenerOCrearUsuarioPrueba(
    `qa.bandejas.propuesto.${RUN_ID}@example.invalid`,
    'Responsable Propuesto QA',
    '829900200',
  );

  const vinculo = await prisma.clienteBarberia.findUnique({
    where: { uk_cliente_barberia: { usuarioId: cliente.id, barberiaId: barberia.id } },
  });
  if (!vinculo) {
    await prisma.clienteBarberia.create({
      data: {
        usuarioId: cliente.id,
        barberiaId: barberia.id,
        contadorNoPresentado: 5,
        estaRestringido: true,
        motivoRestriccion: `${SEED_MARKER}: restricción sintética para validar la reactivación.`,
      },
    });
  }

  const solicitudes = [
    {
      tipo: 'NOMBRE',
      valorNuevo: `Sede QA aprobada ${RUN_ID}`,
    },
    {
      tipo: 'RESPONSABLE',
      valorNuevo: propuesto.id,
    },
  ] as const;

  for (const solicitud of solicitudes) {
    const existente = await prisma.solicitudCambioBarberia.findFirst({
      where: {
        barberiaId: barberia.id,
        tipo: solicitud.tipo,
        valorNuevo: solicitud.valorNuevo,
      },
    });
    if (!existente) {
      await prisma.solicitudCambioBarberia.create({
        data: {
          barberiaId: barberia.id,
          tipo: solicitud.tipo,
          valorNuevo: solicitud.valorNuevo,
          estado: 'PENDIENTE',
          solicitadoPor: asignacionAdmin.usuarioId,
        },
      });
    }
  }

  const [solicitudesPendientes, restriccionesActivas] = await Promise.all([
    prisma.solicitudCambioBarberia.count({
      where: { barberiaId: barberia.id, estado: 'PENDIENTE' },
    }),
    prisma.clienteBarberia.count({
      where: { barberiaId: barberia.id, estaRestringido: true },
    }),
  ]);

  console.log(JSON.stringify({
    seed: SEED_MARKER,
    barberia: { id: barberia.id, nombre: barberia.nombre },
    solicitudesPendientes,
    restriccionesActivas,
    usuarioSolicitante: asignacionAdmin.usuario.correo,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error('Falló seed:bandejas:', error instanceof Error ? error.message : 'error desconocido');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
