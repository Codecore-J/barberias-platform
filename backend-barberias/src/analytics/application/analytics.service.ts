import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ROL_ADMIN_BARBERIA } from '../../iam/domain/roles.js';
import { TTL_CACHE_ANALITICAS_MS } from '../../shared/cache/app-cache.module.js';
import type { AnaliticasSede, OverviewSedes } from '../domain/analytics.types.js';
import { claveAnaliticasOverview, claveAnaliticasSede } from '../domain/cache-keys.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Analíticas de una sede, con caché delante de Prisma.
   *
   * La validación del rango corre ANTES de mirar la caché: un `desde > hasta`
   * tiene que ser 400 siempre, no depender de lo que otra petición dejó escrito.
   */
  async getShopAnalytics(
    barberiaId: string,
    desde?: string,
    hasta?: string,
  ): Promise<AnaliticasSede> {
    const { inicio, fin } = this.resolverRango(desde, hasta);
    const clave = claveAnaliticasSede(barberiaId, desde, hasta);

    const cacheado = await this.leerCache<AnaliticasSede>(clave);
    if (cacheado !== undefined) return cacheado;

    const datos = await this.calcularShopAnalytics(barberiaId, inicio, fin);
    await this.escribirCache(clave, datos);
    return datos;
  }

  private async calcularShopAnalytics(
    barberiaId: string,
    inicio: Date,
    fin: Date,
  ): Promise<AnaliticasSede> {

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

  /**
   * Rango efectivo de la consulta, en días completos de la sede.
   *
   * Sin fechas: los últimos 30 días hasta hoy. El máximo de 366 impide que una
   * query curiosa convierta una agregación en un barrido de años.
   */
  private resolverRango(desde?: string, hasta?: string): { inicio: Date; fin: Date } {
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

    return { inicio, fin };
  }

  /**
   * Lectura de caché tolerante a fallos.
   *
   * Un Redis caído o lento no puede tumbar el panel: se anota y se sigue a
   * Prisma. La caché es una optimización, no una dependencia de corrección.
   */
  private async leerCache<T>(clave: string): Promise<T | undefined> {
    try {
      const valor = await this.cache.get<T>(clave);
      return valor ?? undefined;
    } catch (error) {
      this.logger.warn(
        `No se pudo leer ${clave} del caché: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async escribirCache(clave: string, valor: unknown): Promise<void> {
    try {
      await this.cache.set(clave, valor, TTL_CACHE_ANALITICAS_MS);
    } catch (error) {
      this.logger.warn(
        `No se pudo escribir ${clave} en el caché: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Resumen consolidado de las sedes que el usuario administra.
   *
   * La clave lleva el usuario (y `esGlobal`) porque el conjunto de sedes forma
   * parte del resultado: compartirla entre dos administradores serviría el
   * balance de una sede a quien no la administra.
   */
  async getShopsOverview(
    user: any,
    desde?: string,
    hasta?: string,
    esGlobal = false,
  ): Promise<OverviewSedes> {
    const { inicio, fin } = this.resolverRango(desde, hasta);
    const clave = claveAnaliticasOverview(user.id, desde, hasta, esGlobal);

    const cacheado = await this.leerCache<OverviewSedes>(clave);
    if (cacheado !== undefined) return cacheado;

    const datos = await this.calcularOverview(user, inicio, fin, esGlobal);
    await this.escribirCache(clave, datos);
    return datos;
  }

  private async calcularOverview(
    user: any,
    inicio: Date,
    fin: Date,
    esGlobal: boolean,
  ): Promise<OverviewSedes> {

    let barberiaIds: string[] = [];
    if (esGlobal) {
      const todas = await this.prisma.barberia.findMany({ select: { id: true } });
      barberiaIds = todas.map((b) => b.id);
    } else {
      // Solo el rol gerencial de la sede (ADMIN_BARBERIA) habilita el balance
      // financiero del overview. Ni un CLIENTE ni un BARBERO del mismo local
      // deben poder auditar los ingresos de su sucursal.
      const vinculosRol = await this.prisma.usuarioRol.findMany({
        where: {
          usuarioId: user.id,
          barberiaId: { not: null },
          rol: { nombre: ROL_ADMIN_BARBERIA },
        },
        select: { barberiaId: true },
      });

      const ids = new Set<string>();
      for (const vr of vinculosRol) {
        if (vr.barberiaId) ids.add(vr.barberiaId);
      }
      // Respaldo: las sedes que el propio token declara como administradas,
      // siempre para el rol gerencial.
      if (user?.rolesDetallados) {
        for (const rol of user.rolesDetallados) {
          if (rol.nombre === ROL_ADMIN_BARBERIA && rol.barberiaId) {
            ids.add(rol.barberiaId);
          }
        }
      }
      barberiaIds = Array.from(ids);
    }

    const barberias = await this.prisma.barberia.findMany({
      where: { id: { in: barberiaIds } },
      select: { id: true, nombre: true, activa: true },
    });

    const sedes = [];
    for (const barberia of barberias) {
      const reservas = await this.prisma.reserva.findMany({
        where: {
          barberiaId: barberia.id,
          fechaCita: { gte: inicio, lte: fin },
        },
        select: { estado: true, recordatorioEnviado: true },
      });

      const totalCitas = reservas.length;
      const citasCompletadas = reservas.filter((r) => r.estado === 'COMPLETADA' || r.estado === 'ATENDIDA').length;
      const inasistencias = reservas.filter((r) => r.estado === 'INASISTENCIA' || r.estado === 'NO_PRESENTADO').length;
      const cerradas = reservas.filter((r) => ['COMPLETADA', 'ATENDIDA', 'CANCELADA', 'INASISTENCIA', 'NO_PRESENTADO', 'RECHAZADA'].includes(r.estado)).length;
      const tasaInasistencia = cerradas > 0 ? Number(((inasistencias / cerradas) * 100).toFixed(2)) : 0;
      const recordatoriosEnviados = reservas.filter((r) => r.recordatorioEnviado).length;

      const pagos = await this.prisma.pago.findMany({
        where: {
          reserva: { barberiaId: barberia.id },
          estadoPago: { not: 'ANULADO' },
          registradoAt: { gte: inicio, lte: fin },
        },
        select: { monto: true },
      });
      const ingresos = pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0);

      sedes.push({
        barberiaId: barberia.id,
        nombre: barberia.nombre,
        activa: barberia.activa,
        ingresos: Number(ingresos.toFixed(2)),
        totalCitas,
        citasCompletadas,
        tasaInasistencia,
        recordatoriosEnviados,
      });
    }

    const ingresosConsolidados = sedes.reduce((sum, s) => sum + s.ingresos, 0);
    const totalCitasGlobal = sedes.reduce((sum, s) => sum + s.totalCitas, 0);
    const inasistenciasGlobal = sedes.reduce((sum, s) => {
      // approximate from tasa * cerradas not stored; better recompute
      return sum;
    }, 0);
    // compute properly
    let totalInasistencias = 0;
    let totalCerradas = 0;
    for (const barberia of barberias) {
      const reservas = await this.prisma.reserva.findMany({
        where: {
          barberiaId: barberia.id,
          fechaCita: { gte: inicio, lte: fin },
        },
        select: { estado: true },
      });
      totalInasistencias += reservas.filter((r) => r.estado === 'INASISTENCIA' || r.estado === 'NO_PRESENTADO').length;
      totalCerradas += reservas.filter((r) => ['COMPLETADA', 'ATENDIDA', 'CANCELADA', 'INASISTENCIA', 'NO_PRESENTADO', 'RECHAZADA'].includes(r.estado)).length;
    }
    const tasaGlobalInasistencia = totalCerradas > 0 ? Number(((totalInasistencias / totalCerradas) * 100).toFixed(2)) : 0;
    let totalCanceladas = 0;
    for (const barberia of barberias) {
      const reservas = await this.prisma.reserva.findMany({
        where: {
          barberiaId: barberia.id,
          fechaCita: { gte: inicio, lte: fin },
        },
        select: { estado: true },
      });
      totalCanceladas += reservas.filter((r) => r.estado === 'CANCELADA').length;
    }
    const tasaGlobalCancelacion = totalCerradas > 0 ? Number(((totalCanceladas / totalCerradas) * 100).toFixed(2)) : 0;

    return {
      periodo: {
        desde: inicio.toISOString().split('T')[0],
        hasta: fin.toISOString().split('T')[0],
      },
      totalesGlobales: {
        ingresosConsolidados: Number(ingresosConsolidados.toFixed(2)),
        totalCitas: totalCitasGlobal,
        tasaGlobalInasistencia,
        tasaGlobalCancelacion,
      },
      sedes,
    };
  }
}
