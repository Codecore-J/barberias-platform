import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getShopAnalytics(
    barberiaId: string,
    desde?: string,
    hasta?: string,
  ) {
    const hoy = new Date();
    const hastaDate = hasta ? this.parseDate(hasta) : new Date(hoy);
    const desdeDate = desde ? this.parseDate(desde) : this.addDays(new Date(hastaDate), -29);

    // Normalize to start/end of day
    const inicio = new Date(desdeDate);
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(hastaDate);
    fin.setHours(23, 59, 59, 999);

    if (inicio > fin) {
      throw new BadRequestException('El rango de fechas es inválido');
    }

    const diffDays = Math.floor((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 366) {
      throw new BadRequestException('El rango no puede superar los 366 días');
    }

    // Reservations in period by fechaCita
    const reservas = await this.prisma.reserva.findMany({
      where: {
        barberiaId,
        fechaCita: {
          gte: inicio,
          lte: fin,
        },
      },
      select: {
        id: true,
        estado: true,
        barberoId: true,
        recordatorioEnviado: true,
        barbero: { select: { id: true, nombreCompleto: true } },
      },
    });

    const resumenPorEstado: Record<string, number> = {};
    for (const r of reservas) {
      resumenPorEstado[r.estado] = (resumenPorEstado[r.estado] || 0) + 1;
    }

    // Closed states
    const estadosCerrados = ['COMPLETADA', 'ATENDIDA', 'CANCELADA', 'INASISTENCIA', 'NO_PRESENTADO', 'RECHAZADA'];
    const cerradas = reservas.filter((r) => estadosCerrados.includes(r.estado)).length;
    const inasistencias = reservas.filter((r) => r.estado === 'INASISTENCIA' || r.estado === 'NO_PRESENTADO').length;
    const canceladas = reservas.filter((r) => r.estado === 'CANCELADA').length;

    const tasaInasistencia = cerradas > 0 ? (inasistencias / cerradas) * 100 : 0;
    const tasaCancelacion = cerradas > 0 ? (canceladas / cerradas) * 100 : 0;

    const recordatoriosEnviados = reservas.filter((r) => r.recordatorioEnviado).length;

    // Waitlist notified in range
    const listaEsperaNotificados = await this.prisma.listaEspera.count({
      where: {
        barberiaId,
        estado: 'NOTIFICADO',
        actualizadoAt: {
          gte: inicio,
          lte: fin,
        },
      },
    });

    // Payments in period (valid, not cancelled)
    const pagos = await this.prisma.pago.findMany({
      where: {
        reserva: {
          barberiaId,
        },
        estadoPago: {
          not: 'ANULADO',
        },
        registradoAt: {
          gte: inicio,
          lte: fin,
        },
      },
      select: {
        monto: true,
        metodoPago: true,
        reserva: { select: { barberoId: true } },
      },
    });

    const totalRecaudado = pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0);
    const ticketPromedio = pagos.length > 0 ? totalRecaudado / pagos.length : 0;

    const porMetodoPago: Record<string, number> = {};
    for (const p of pagos) {
      porMetodoPago[p.metodoPago] = (porMetodoPago[p.metodoPago] || 0) + Number(p.monto || 0);
    }

    // Performance by barber
    const barberoMap = new Map<string, any>();
    for (const r of reservas) {
      if (!r.barberoId) continue;
      const key = r.barberoId;
      if (!barberoMap.has(key)) {
        barberoMap.set(key, {
          barberoId: r.barberoId,
          nombre: r.barbero?.nombreCompleto || '',
          citasCompletadas: 0,
          inasistencias: 0,
          ingresosGenerados: 0,
        });
      }
      const entry = barberoMap.get(key);
      if (r.estado === 'COMPLETADA' || r.estado === 'ATENDIDA') {
        entry.citasCompletadas++;
      }
      if (r.estado === 'INASISTENCIA' || r.estado === 'NO_PRESENTADO') {
        entry.inasistencias++;
      }
    }
    // Add ingresos by barber from pagos
    for (const p of pagos) {
      const bid = p.reserva?.barberoId;
      if (bid && barberoMap.has(bid)) {
        barberoMap.get(bid).ingresosGenerados += Number(p.monto || 0);
      } else if (bid) {
        barberoMap.set(bid, {
          barberoId: bid,
          nombre: '',
          citasCompletadas: 0,
          inasistencias: 0,
          ingresosGenerados: Number(p.monto || 0),
        });
      }
    }

    return {
      periodo: {
        desde: inicio.toISOString().split('T')[0],
        hasta: fin.toISOString().split('T')[0],
      },
      resumenCitas: {
        total: reservas.length,
        porEstado: resumenPorEstado,
      },
      retencion: {
        tasaInasistencia: Number(tasaInasistencia.toFixed(2)),
        tasaCancelacion: Number(tasaCancelacion.toFixed(2)),
        recordatoriosEnviados,
        cuposListaEsperaNotificados: listaEsperaNotificados,
      },
      ingresos: {
        totalRecaudado: Number(totalRecaudado.toFixed(2)),
        ticketPromedio: Number(ticketPromedio.toFixed(2)),
        porMetodoPago,
      },
      rendimientoPorBarbero: Array.from(barberoMap.values()),
    };
  }

  private parseDate(s: string): Date {
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) {
      throw new BadRequestException('Formato de fecha inválido');
    }
    return d;
  }

  private addDays(d: Date, days: number): Date {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + days);
    return nd;
  }
}
