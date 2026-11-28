import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ROL_ADMIN_BARBERIA } from '../../iam/domain/roles.js';
import { TiempoService, ZONA_POR_DEFECTO } from '../../shared/time/tiempo.service.js';
import { TTL_CACHE_ANALITICAS_MS } from '../../shared/cache/app-cache.module.js';
import type { AnaliticasSede, OverviewSedes } from '../domain/analytics.types.js';
import type { MetricasPlataformaHoyDto } from '../dto/metricas-plataforma-hoy.dto.js';
import { claveAnaliticasOverview, claveAnaliticasSede } from '../domain/cache-keys.js';
import { construirCsvAnaliticas } from '../domain/analytics-csv.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly tiempo: TiempoService,
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

  /**
   * Paso 13 · mismo cálculo que `getShopAnalytics`, serializado a CSV. La
   * exportación no duplica métricas: si cambia el reporte, cambia el CSV.
   */
  async getShopAnalyticsCsv(barberiaId: string, desde?: string, hasta?: string): Promise<string> {
    const data = await this.getShopAnalytics(barberiaId, desde, hasta);
    return construirCsvAnaliticas(barberiaId, data);
  }

  /**
   * T-15 · métricas del día para el home del ADMINISTRADOR global.
   *
   * No recibe `barberiaId` a propósito: es una lectura de plataforma y su
   * alcance lo decide el rol en el controlador. Tampoco pasa por el caché de
   * analíticas: son cinco contadores con índice (`fecha_cita`, `registrado_at`,
   * `estado`), y un caché de un minuto en una pantalla de inicio solo añade un
   * estado del que fiarse para mostrar cifras de caja viejas.
   *
   * `fecha_cita` es una etiqueta de calendario (DATE) y `registrado_at` un
   * instante (TIMESTAMPTZ): el día se parte en la zona de la SEDE, que es la
   * zona en la que el operador llama «hoy», y el rango es semiabierto
   * `[inicio, mañana)` para que un pago con hora 23:59:59.999 no se quede fuera
   * por un milisegundo.
   *
   * T-42 · «hoy» sale de `TiempoService` con la zona de la sede, no del reloj
   * del proceso: Render corre en UTC y con `setHours(0,0,0,0)` la ventana se
   * desplazaba hasta 4 h respecto del día real, así que «Citas hoy» contaba el
   * día equivocado en cuanto el proceso no estaba en UTC-4. La etiqueta de
   * calendario se compara con medianoches UTC del día etiquetado (que es como
   * Prisma escribe y devuelve un DATE); el dinero se acota con instantes
   * reales de la sede.
   */
  async metricasPlataformaHoy(): Promise<MetricasPlataformaHoyDto> {
    const zona = ZONA_POR_DEFECTO;
    const hoy = this.tiempo.fechaLocal(this.tiempo.ahora(), zona);
    const manana = this.tiempo.sumarDias(hoy, 1);
    const inicio = this.tiempo.aInstante(hoy, '00:00', zona);
    const fin = this.tiempo.aInstante(manana, '00:00', zona);

    const [sedesActivas, citasHoy, recaudado, cajasAbiertas, usuariosActivos] = await Promise.all([
      this.prisma.barberia.count({ where: { estado: 'ACTIVO' } }),
      this.prisma.reserva.count({
        where: {
          fechaCita: {
            gte: this.tiempo.fechaDeCalendario(hoy),
            lt: this.tiempo.fechaDeCalendario(manana),
          },
        },
      }),
      this.prisma.pago.aggregate({
        _sum: { monto: true },
        // §7.4: un cobro ANULADO no es ingreso, y la fecha del dinero es la del
        // cobro, no la de la cita.
        where: {
          estadoPago: { not: 'ANULADO' },
          registradoAt: { gte: inicio, lt: fin },
        },
      }),
      this.prisma.cierreCaja.count({ where: { estado: 'ABIERTO' } }),
      this.prisma.usuario.count({ where: { estadoCuenta: 'ACTIVO' } }),
    ]);

    return {
      fecha: hoy,
      sedesActivas,
      citasHoy,
      recaudadoHoy: Number(Number(recaudado._sum.monto ?? 0).toFixed(2)),
      cajasAbiertas,
      usuariosActivos,
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
      // `warn` y no `error`: la petición se resuelve igual contra Prisma, así
      // que esto no es un 5xx ni debe despertar a nadie de guardia. El texto
      // lleva la clave para saber QUÉ sede y QUÉ rango se quedaron sin caché.
      this.logger.warn(
        `Caché no disponible (no bloqueante): fallo al leer ${clave}; se calcula contra Prisma: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async escribirCache(clave: string, valor: unknown): Promise<void> {
    try {
      await this.cache.set(clave, valor, TTL_CACHE_ANALITICAS_MS);
    } catch (error) {
      // El resultado ya se calculó y se devuelve: solo se pierde la próxima
      // lectura rápida. Nivel `warn` con la clave afectada.
      this.logger.warn(
        `Caché no disponible (no bloqueante): fallo al guardar ${clave}; la respuesta ya se calculó: ${
          error instanceof Error ? error.message : String(error)
        }`,
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

    // E4-04: la columna de estado es `estado` (`ACTIVO`/`INACTIVO`), no `activa`.
    // Seleccionar `activa` aquí compilaba —el select es un objeto— pero Prisma lo
    // rechazaba en ejecución y el overview respondía 400 en producción.
    const barberias = await this.prisma.barberia.findMany({
      where: { id: { in: barberiaIds } },
      select: { id: true, nombre: true, estado: true },
    });

    // F8 · rendimiento (N+1 del overview).
    //
    // Antes, por cada sede se leían sus reservas TRES veces —totales, cálculo
    // global de inasistencias y cálculo global de cancelaciones— y sus pagos una
    // vez. Con 13 sedes eran 54 consultas en serie; con 50 pasaban de 200, y el
    // coste crecía con cada sede nueva. Ahora la base agrega y el servicio solo
    // reparte:
    //   1. las sedes del alcance (la consulta de arriba),
    //   2. las reservas del periodo agrupadas por sede, estado y recordatorio,
    //   3. los pagos no anulados agrupados por sede.
    // El número de consultas es constante (3) sea cual sea el número de sedes.
    const idsDeSedes = barberias.map((b) => b.id);

    const [conteos, ingresosPorSede] = await Promise.all([
      this.prisma.reserva.groupBy({
        by: ['barberiaId', 'estado', 'recordatorioEnviado'],
        where: { barberiaId: { in: idsDeSedes }, fechaCita: { gte: inicio, lte: fin } },
        _count: { _all: true },
      }),
      this.prisma.pago.groupBy({
        by: ['barberiaId'],
        where: {
          // El conjunto se acota por la sede de la RESERVA (lo mismo que leía el
          // código anterior) y se agrupa por `pagos.barberia_id`, la copia de la
          // sede del cobro que escribe la misma transacción y que tiene índice
          // `idx_pagos_barberia_fecha`.
          reserva: { barberiaId: { in: idsDeSedes } },
          estadoPago: { not: 'ANULADO' },
          registradoAt: { gte: inicio, lte: fin },
        },
        _sum: { monto: true },
      }),
    ]);

    const ESTADOS_CERRADOS = [
      'COMPLETADA',
      'ATENDIDA',
      'CANCELADA',
      'INASISTENCIA',
      'NO_PRESENTADO',
      'RECHAZADA',
    ];
    const ESTADOS_INASISTENCIA = ['INASISTENCIA', 'NO_PRESENTADO'];

    interface RecuentoDeSede {
      total: number;
      completadas: number;
      inasistencias: number;
      cerradas: number;
      canceladas: number;
      recordatorios: number;
    }

    const recuentos = new Map<string, RecuentoDeSede>();
    for (const fila of conteos) {
      const cantidad = fila._count._all;
      const recuento = recuentos.get(fila.barberiaId) ?? {
        total: 0,
        completadas: 0,
        inasistencias: 0,
        cerradas: 0,
        canceladas: 0,
        recordatorios: 0,
      };

      recuento.total += cantidad;
      if (fila.estado === 'COMPLETADA' || fila.estado === 'ATENDIDA') recuento.completadas += cantidad;
      if (ESTADOS_INASISTENCIA.includes(fila.estado)) recuento.inasistencias += cantidad;
      if (ESTADOS_CERRADOS.includes(fila.estado)) recuento.cerradas += cantidad;
      if (fila.estado === 'CANCELADA') recuento.canceladas += cantidad;
      if (fila.recordatorioEnviado) recuento.recordatorios += cantidad;

      recuentos.set(fila.barberiaId, recuento);
    }

    const ingresosPorSedeId = new Map(
      ingresosPorSede.map((fila) => [fila.barberiaId, Number(fila._sum.monto ?? 0)]),
    );

    const sedes = barberias.map((barberia) => {
      const recuento = recuentos.get(barberia.id);
      const ingresos = ingresosPorSedeId.get(barberia.id) ?? 0;

      return {
        barberiaId: barberia.id,
        nombre: barberia.nombre,
        activa: barberia.estado === 'ACTIVO',
        ingresos: Number(ingresos.toFixed(2)),
        totalCitas: recuento?.total ?? 0,
        citasCompletadas: recuento?.completadas ?? 0,
        tasaInasistencia:
          recuento && recuento.cerradas > 0
            ? Number(((recuento.inasistencias / recuento.cerradas) * 100).toFixed(2))
            : 0,
        recordatoriosEnviados: recuento?.recordatorios ?? 0,
      };
    });

    const ingresosConsolidados = sedes.reduce((sum, s) => sum + s.ingresos, 0);
    const totalCitasGlobal = sedes.reduce((sum, s) => sum + s.totalCitas, 0);

    // Las tasas globales usan el mismo denominador que la tasa por sede: los
    // estados CERRADOS del periodo en las sedes del alcance.
    const totalCerradas = barberias.reduce((sum, b) => sum + (recuentos.get(b.id)?.cerradas ?? 0), 0);
    const totalInasistencias = barberias.reduce(
      (sum, b) => sum + (recuentos.get(b.id)?.inasistencias ?? 0),
      0,
    );
    const totalCanceladas = barberias.reduce(
      (sum, b) => sum + (recuentos.get(b.id)?.canceladas ?? 0),
      0,
    );

    const tasaGlobalInasistencia =
      totalCerradas > 0 ? Number(((totalInasistencias / totalCerradas) * 100).toFixed(2)) : 0;
    const tasaGlobalCancelacion =
      totalCerradas > 0 ? Number(((totalCanceladas / totalCerradas) * 100).toFixed(2)) : 0;

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
