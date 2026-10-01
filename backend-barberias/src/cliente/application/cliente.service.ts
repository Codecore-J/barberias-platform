import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/infrastructure/prisma.service.js';

@Injectable()
export class ClienteService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerFicha(clienteId: string, barberiaId: string) {
    const cliente = await this.prisma.usuario.findUnique({
      where: { id: clienteId }
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const reservas = await this.prisma.reserva.findMany({
      where: { clienteId, barberiaId }
    });

    const totalCitas = reservas.filter(r => r.estado === 'COMPLETADA').length;
    const totalCanceladas = reservas.filter(r => r.estado === 'NO_ASISTIO' || r.estado === 'CANCELADA_TARDE').length;

    const antecedentes = await this.prisma.antecedente.findMany({
      where: { usuarioId: clienteId, barberiaOrigenId: barberiaId },
      orderBy: { creadoAt: 'desc' }
    });

    return {
      id: cliente.id,
      nombre: cliente.nombreCompleto,
      telefono: cliente.telefono,
      totalCitas,
      totalCanceladas,
      notas: antecedentes.map(a => ({
        id: a.id,
        contenido: a.contenido,
        fechaCreacion: a.creadoAt?.toISOString() || new Date().toISOString()
      }))
    };
  }

  async guardarNota(clienteId: string, barberiaId: string, barberoId: string, contenido: string) {
    const antecedente = await this.prisma.antecedente.create({
      data: {
        usuarioId: clienteId,
        barberiaOrigenId: barberiaId,
        categoria: 'NOTA_GENERAL',
        contenido,
        origen: 'BARBERO',
        estadoValidacion: 'APROBADO',
        compartido: false
      }
    });

    return {
      id: antecedente.id,
      contenido: antecedente.contenido,
      fechaCreacion: antecedente.creadoAt?.toISOString() || new Date().toISOString()
    };
  }
}
