import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Validación deliberadamente previa a construir PrismaClient: el script debe
 * fallar antes de abrir una conexión cuando no se habilita explícitamente o
 * cuando el destino no es PostgreSQL local.
 */
function validarDestinoSeguro(): void {
  if (process.env.APP_ENV !== 'dev') {
    throw new Error(
      'ABORTADO: seed:bandejas solo puede ejecutarse con APP_ENV=dev.',
    );
  }
  if (process.env.ALLOW_SEED !== 'true') {
    throw new Error(
      'ABORTADO: define ALLOW_SEED=true explícitamente para habilitar seed:bandejas.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'ABORTADO: DATABASE_URL es obligatorio para seed:bandejas.',
    );
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('ABORTADO: DATABASE_URL no es una URL válida.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())) {
    throw new Error(
      'ABORTADO: DATABASE_URL debe usar el protocolo PostgreSQL.',
    );
  }

  const parametrosDeHost = new Set([
    'host',
    'hostaddr',
    'socket',
    'socketfactory',
  ]);
  if (
    [...url.searchParams.keys()].some((key) =>
      parametrosDeHost.has(key.toLowerCase()),
    )
  ) {
    throw new Error(
      'ABORTADO: DATABASE_URL no puede sobrescribir el host local mediante parámetros.',
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      'ABORTADO: seed:bandejas solo admite DATABASE_URL con host localhost, 127.0.0.1 o ::1.',
    );
  }
}

validarDestinoSeguro();

const RUN_ID = '20261102-v1';
const SEED_MARKER = `QA-BANDEJAS-${RUN_ID}`;
const prisma = new PrismaClient();

async function telefonoDisponible(
  tx: Prisma.TransactionClient,
  correo: string,
  base: string,
): Promise<string> {
  const usuarioExistente = await tx.usuario.findUnique({ where: { correo } });
  if (usuarioExistente) return usuarioExistente.telefono;

  for (let intento = 0; intento < 100; intento++) {
    const telefono = `${base}${String(intento).padStart(2, '0')}`;
    const ocupado = await tx.usuario.findUnique({ where: { telefono } });
    if (!ocupado) return telefono;
  }

  throw new Error(
    `No se encontró un teléfono de prueba disponible para ${correo}.`,
  );
}

async function obtenerOCrearUsuarioPrueba(
  tx: Prisma.TransactionClient,
  correo: string,
  nombreCompleto: string,
  baseTelefono: string,
): Promise<{ id: string }> {
  const existente = await tx.usuario.findUnique({ where: { correo } });
  if (existente) return existente;

  const telefono = await telefonoDisponible(tx, correo, baseTelefono);
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  return tx.usuario.create({
    data: { correo, nombreCompleto, telefono, passwordHash },
  });
}

async function main(): Promise<void> {
  const resultado = await prisma.$transaction(async (tx) => {
    const rolAdmin = await tx.rol.findUnique({
      where: { nombre: 'ADMINISTRADOR' },
    });
    if (!rolAdmin || rolAdmin.ambito !== 'GLOBAL') {
      throw new Error('No existe el rol global ADMINISTRADOR; seed cancelado.');
    }

    const asignacionAdmin = await tx.usuarioRol.findFirst({
      where: { rolId: rolAdmin.id, barberiaId: null },
      include: { usuario: true },
    });
    if (!asignacionAdmin || asignacionAdmin.usuario.estadoCuenta !== 'ACTIVO') {
      throw new Error(
        'No se encontró un ADMINISTRADOR global activo para la sede QA.',
      );
    }

    const codigoAcceso = SEED_MARKER;
    const barberia = await tx.barberia.upsert({
      where: { codigoAcceso },
      update: {},
      create: {
        nombre: `QA Bandejas ${RUN_ID}`,
        descripcion:
          'Sede sintética para validación E2E de bandejas administrativas.',
        telefono: '8090000000',
        ubicacion: 'Entorno QA, datos sintéticos',
        codigoAcceso,
        enlaceUnico: `qa-bandejas-${RUN_ID}`,
        responsableId: asignacionAdmin.usuarioId,
      },
    });

    const cliente = await obtenerOCrearUsuarioPrueba(
      tx,
      `qa.bandejas.cliente.${RUN_ID}@example.invalid`,
      'Cliente QA Bandejas',
      '829900100',
    );
    const propuesto = await obtenerOCrearUsuarioPrueba(
      tx,
      `qa.bandejas.propuesto.${RUN_ID}@example.invalid`,
      'Responsable Propuesto QA',
      '829900200',
    );

    const vinculo = await tx.clienteBarberia.findUnique({
      where: {
        uk_cliente_barberia: { usuarioId: cliente.id, barberiaId: barberia.id },
      },
    });
    if (!vinculo) {
      await tx.clienteBarberia.create({
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
      { tipo: 'NOMBRE', valorNuevo: `Sede QA aprobada ${RUN_ID}` },
      { tipo: 'RESPONSABLE', valorNuevo: propuesto.id },
    ] as const;

    for (const solicitud of solicitudes) {
      const existente = await tx.solicitudCambioBarberia.findFirst({
        where: {
          barberiaId: barberia.id,
          tipo: solicitud.tipo,
          valorNuevo: solicitud.valorNuevo,
        },
      });
      if (!existente) {
        await tx.solicitudCambioBarberia.create({
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
      tx.solicitudCambioBarberia.count({
        where: { barberiaId: barberia.id, estado: 'PENDIENTE' },
      }),
      tx.clienteBarberia.count({
        where: { barberiaId: barberia.id, estaRestringido: true },
      }),
    ]);

    return {
      seed: SEED_MARKER,
      barberia: { id: barberia.id, nombre: barberia.nombre },
      solicitudesPendientes,
      restriccionesActivas,
      usuarioSolicitante: asignacionAdmin.usuario.correo,
    };
  });

  // El mensaje solo se imprime cuando Prisma confirmó el COMMIT.
  console.log(JSON.stringify(resultado, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(
      'Falló seed:bandejas:',
      error instanceof Error ? error.message : 'error desconocido',
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
