/**
 * E3-12 · reglas de vinculación, sexta aprobación y desvinculación.
 *
 * Unitarios del servicio: prisma va mockeado. Cubren lo que la tarea pide
 * comprobar —límite 5/6, desvincular con reservas futuras, revincular
 * conservando la restricción— más los guardas de la resolución de plataforma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { BarberiaService } from './barberia.service.js';

const VINCULACION = '9f0b0000-0000-4000-8000-000000000001';
const CLIENTE = '9f0b0000-0000-4000-8000-000000000002';
const SEDE = '9f0b0000-0000-4000-8000-000000000003';

const admin = { id: '9f0b0000-0000-4000-8000-00000000000a', roles: ['ADMINISTRADOR'] } as any;

function nuevoPrisma() {
  const prisma: any = {
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    barberia: { findUnique: vi.fn(), findMany: vi.fn() },
    clienteBarberia: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    reserva: { count: vi.fn() },
  };
  return prisma;
}

describe('E3-12 · vinculación, sexta aprobación y desvinculación', () => {
  let prisma: any;
  let service: BarberiaService;
  let auditar: any;
  let notificar: any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = nuevoPrisma();
    auditar = { registrarEvento: vi.fn().mockResolvedValue({}) };
    notificar = { enviarNotificacion: vi.fn().mockResolvedValue({}) };
    service = new BarberiaService(prisma, auditar, notificar);
  });

  // ── Límite 5 / 6 ──────────────────────────────────────────────────────────

  describe('límite de 5 barberías', () => {
    const barberia = { id: SEDE, estado: 'ACTIVO', codigoAcceso: 'ABC12345', zonaHoraria: 'America/Santo_Domingo' };

    it('la 6ª vinculación queda PENDIENTE_APROBACION (D10)', async () => {
      prisma.barberia.findUnique.mockResolvedValue(barberia);
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);
      prisma.clienteBarberia.count.mockResolvedValue(5);
      prisma.clienteBarberia.create.mockResolvedValue({ id: VINCULACION, estadoVinculacion: 'PENDIENTE_APROBACION' });

      const res = await service.vincularCliente(CLIENTE, { codigoAcceso: 'ABC12345' } as any);

      expect(prisma.clienteBarberia.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ estadoVinculacion: 'PENDIENTE_APROBACION' }),
      });
      expect(res.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    });

    it('la 5ª (cuando lleva 4) sigue siendo ACTIVO sin pasar por aprobación', async () => {
      prisma.barberia.findUnique.mockResolvedValue(barberia);
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);
      prisma.clienteBarberia.count.mockResolvedValue(4);
      prisma.clienteBarberia.create.mockResolvedValue({ id: VINCULACION, estadoVinculacion: 'ACTIVO' });

      await service.vincularCliente(CLIENTE, { codigoAcceso: 'ABC12345' } as any);

      expect(prisma.clienteBarberia.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ estadoVinculacion: 'ACTIVO' }),
      });
    });
  });

  // ── Revincular (D20 / D21) ────────────────────────────────────────────────

  describe('revincular (D21 reactiva la fila, D20 conserva la restricción)', () => {
    it('una fila DESVINCULADO se reactiva y NO se borra ni se recrea', async () => {
      prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, estado: 'ACTIVO', codigoAcceso: 'ABC12345' });
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: VINCULACION,
        estadoVinculacion: 'DESVINCULADO',
        contadorNoPresentado: 5,
        estaRestringido: true,
      });
      prisma.clienteBarberia.findFirst.mockResolvedValue(null);
      prisma.clienteBarberia.update.mockResolvedValue({
        id: VINCULACION,
        estadoVinculacion: 'ACTIVO',
        contadorNoPresentado: 5,
        estaRestringido: true,
      });

      const res = await service.vincularCliente(CLIENTE, { codigoAcceso: 'ABC12345' } as any);

      // D20: se actualiza la MISMA fila; la restricción y el contador sobreviven.
      expect(prisma.clienteBarberia.create).not.toHaveBeenCalled();
      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULACION },
        data: expect.objectContaining({ estadoVinculacion: 'ACTIVO' }),
      });
      expect(res.estaRestringido).toBe(true);
      expect(res.contadorNoPresentado).toBe(5);
    });

    it('revincular sin otra activa la convierte en la sede activa', async () => {
      prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, estado: 'ACTIVO', codigoAcceso: 'ABC12345' });
      prisma.clienteBarberia.findUnique.mockResolvedValue({ id: VINCULACION, estadoVinculacion: 'DESVINCULADO' });
      prisma.clienteBarberia.findFirst.mockResolvedValue(null);
      prisma.clienteBarberia.update.mockResolvedValue({ id: VINCULACION, esBarberiaActiva: true });

      await service.vincularCliente(CLIENTE, { codigoAcceso: 'ABC12345' } as any);

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULACION },
        data: expect.objectContaining({ esBarberiaActiva: true }),
      });
    });

    it('ya vinculado (ACTIVO) es idempotente: no escribe nada', async () => {
      prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, estado: 'ACTIVO', codigoAcceso: 'ABC12345' });
      prisma.clienteBarberia.findUnique.mockResolvedValue({ id: VINCULACION, estadoVinculacion: 'ACTIVO' });

      const res = await service.vincularCliente(CLIENTE, { codigoAcceso: 'ABC12345' } as any);

      expect(res.id).toBe(VINCULACION);
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(prisma.clienteBarberia.create).not.toHaveBeenCalled();
    });
  });

  // ── Desvincular ───────────────────────────────────────────────────────────

  describe('desvincular', () => {
    const sede = { id: SEDE, estado: 'ACTIVO', zonaHoraria: 'America/Santo_Domingo' };

    it('ROJO: bloquea con reservas futuras vivas (422 RESERVAS_FUTURAS)', async () => {
      prisma.barberia.findUnique.mockResolvedValue(sede);
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: VINCULACION,
        estadoVinculacion: 'ACTIVO',
        contadorNoPresentado: 1,
        estaRestringido: false,
      });
      prisma.reserva.count.mockResolvedValue(2);

      await expect(service.desvincular(CLIENTE, SEDE)).rejects.toThrow(UnprocessableEntityException);

      expect(prisma.reserva.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          estado: { in: ['PENDIENTE', 'PROPUESTA_PENDIENTE', 'CONFIRMADA'] },
        }),
      });
      // No se desvincula y no se audita.
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditar.registrarEvento).not.toHaveBeenCalled();
    });

    it('VERDE: sin reservas vivas escribe DESVINCULADO y apaga la sede activa', async () => {
      prisma.barberia.findUnique.mockResolvedValue(sede);
      prisma.clienteBarberia.findUnique.mockResolvedValue({
        id: VINCULACION,
        estadoVinculacion: 'ACTIVO',
        contadorNoPresentado: 3,
        estaRestringido: true,
      });
      prisma.reserva.count.mockResolvedValue(0);
      prisma.clienteBarberia.update.mockResolvedValue({
        id: VINCULACION,
        estadoVinculacion: 'DESVINCULADO',
        esBarberiaActiva: false,
      });

      const res = await service.desvincular(CLIENTE, SEDE);

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULACION },
        data: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
      });
      // D20: el historial de inasistencias queda intacto en la misma fila.
      expect(prisma.clienteBarberia.deleteMany).toBeUndefined();
      expect(auditar.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'VINCULACION_DESVINCULADA',
          contexto: expect.objectContaining({ contadorNoPresentado: 3, estaRestringido: true }),
        }),
        expect.anything(),
      );
      expect(res.estadoVinculacion).toBe('DESVINCULADO');
    });

    it('sin vínculo → 404', async () => {
      prisma.barberia.findUnique.mockResolvedValue(sede);
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);

      await expect(service.desvincular(CLIENTE, SEDE)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Resolución de la 6ª (solo ADMINISTRADOR, se resuelve en el controlador) ─

  describe('aprobar / rechazar', () => {
    const pendiente = {
      id: VINCULACION,
      usuarioId: CLIENTE,
      barberiaId: SEDE,
      estadoVinculacion: 'PENDIENTE_APROBACION',
      usuario: { id: CLIENTE, nombreCompleto: 'C', correo: 'c@t.test' },
      barberia: { id: SEDE, nombre: 'Sede' },
    };

    it('aprobar pasa a ACTIVO, notifica y audita', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente);
      prisma.clienteBarberia.update.mockResolvedValue({ ...pendiente, estadoVinculacion: 'ACTIVO' });

      const res = await service.resolverVinculacion(VINCULACION, 'APROBAR', admin, 'ok');

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULACION },
        data: { estadoVinculacion: 'ACTIVO' },
      });
      expect(auditar.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'VINCULACION_APROBADA' }),
        undefined,
      );
      expect(notificar.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: CLIENTE, tipo: 'VINCULACION_APROBADA' }),
      );
      expect(res.estadoVinculacion).toBe('ACTIVO');
    });

    it('rechazar pasa a DESVINCULADO, notifica con el motivo y audita', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(pendiente);
      prisma.clienteBarberia.update.mockResolvedValue({ ...pendiente, estadoVinculacion: 'DESVINCULADO' });

      await service.resolverVinculacion(VINCULACION, 'RECHAZAR', admin, 'Límite de la plataforma');

      expect(prisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: VINCULACION },
        data: { estadoVinculacion: 'DESVINCULADO' },
      });
      expect(auditar.registrarEvento).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'VINCULACION_RECHAZADA',
          contexto: expect.objectContaining({ motivo: 'Límite de la plataforma' }),
        }),
        undefined,
      );
      expect(notificar.enviarNotificacion).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'VINCULACION_RECHAZADA' }),
      );
    });

    it('una vinculación que no está pendiente → 409 ESTADO_INVALIDO', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue({ ...pendiente, estadoVinculacion: 'ACTIVO' });

      await expect(service.resolverVinculacion(VINCULACION, 'APROBAR', admin)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('una vinculación inexistente → 404', async () => {
      prisma.clienteBarberia.findUnique.mockResolvedValue(null);

      await expect(service.resolverVinculacion(VINCULACION, 'APROBAR', admin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Enlace único / QR ─────────────────────────────────────────────────────

  describe('buscarPorEnlace', () => {
    it('devuelve la lectura PÚBLICA: sin codigoAcceso ni enlaceUnico', async () => {
      prisma.barberia.findUnique.mockResolvedValue({
        id: SEDE,
        nombre: 'Sede QR',
        codigoAcceso: 'SECRETO1',
        enlaceUnico: 'sede-qr',
        estado: 'ACTIVO',
      });

      const res: any = await service.buscarPorEnlace('sede-qr');

      expect(res.nombre).toBe('Sede QR');
      expect(res.codigoAcceso).toBeUndefined();
      expect(res.enlaceUnico).toBeUndefined();
    });

    it('una sede INACTIVA no se resuelve → 404', async () => {
      prisma.barberia.findUnique.mockResolvedValue({ id: SEDE, estado: 'INACTIVO', enlaceUnico: 'x' });

      await expect(service.buscarPorEnlace('x')).rejects.toThrow(NotFoundException);
    });
  });
});
