/**
 * Cotización (D44, E3-03/2): el cálculo del bloque y su precio es una regla de
 * negocio PURA que el frontend nunca hace. El endpoint `POST /reservas/cotizar`
 * devuelve el bloque total, la hora de fin, el margen, el precio total y el
 * desglose de servicios, SIN persistir ningún registro en la base de datos.
 *
 * La misma función pura (`calcularBloque`) se reutiliza en `reserva.service.ts`
 * (cuando se crea la reserva) y, junto con `disponibilidad.service.ts`, en el
 * cálculo de disponibilidad.
 *
 * P3.2 (H-N1): este archivo NO declara ningún DTO de entrada. Aquí vivía un
 * `CreateReservaDto` duplicado que nadie importaba —el vivo es
 * `./create-reserva.dto.ts`— y una trampa latente: editar el de reserva en el
 * archivo equivocado. De este módulo solo se consumen los TIPOS de la respuesta.
 */

/**
 * Desglose de un servicio dentro de la cotización.
 */
export interface ServicioDesglose {
  /** Catálogo heredado (`servicios`). Ausente en el desglose híbrido. */
  servicioId?: string;
  /**
   * V3 fase 4 · catálogo híbrido (`servicios_barbero`). Es el id que el cliente
   * devuelve en `serviciosBarberoIds` al crear la reserva. Ausente en el
   * desglose heredado.
   */
  servicioBarberoId?: string;
  nombre: string;
  precio: number;
  duracionEstimada: number;
  margenOperativo: number;
  /**
   * E4-01: en la cotización grupal indica a qué participante pertenece el
   * servicio (índice del array `participantes` de la petición). Ausente en el
   * flujo individual, que tiene un único participante.
   */
  participanteIndex?: number;
}

/**
 * Resultado del cálculo puro del bloque.
 */
export interface BloqueCalculado {
  /** Duración total del bloque en minutos (Σ duraciones + margen grupal). */
  duracionTotal: number;
  /** Margen total aplicado al bloque en minutos (Σ márgenes individuales + margen grupal de la barbería). */
  margenTotal: number;
  /** Precio total inmutable congelado desde el catálogo de servicios. */
  precioTotal: number;
}

/**
 * Respuesta de cotización sin persistir (D44).
 */
export interface CotizacionResponse {
  /** Identificador de la barbería consultada. */
  barberiaId: string;
  /** Fecha solicitada. */
  fecha: string;
  /** Hora de fin del bloque. */
  horaFin: string;
  /** Total del bloque. */
  bloqueTotal: BloqueCalculado;
  /** Desglose de los servicios incluídos. */
  desgloseServicios: ServicioDesglose[];
}
