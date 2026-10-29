/**
 * V3 fase 5 · respuesta de `GET/PUT /shops/:shopId/mi-horario`.
 *
 * Las horas viajan como etiquetas `HH:mm` (nunca como el ISO de un `TIME` de
 * Prisma), que es lo único que un `<input type="time">` acepta sin disparar el
 * error «The specified value "1970-01-01T08:00:00.000Z" does not conform to the
 * required format "HH:mm"».
 */
export interface DiaHorarioBarberoResponse {
  /** ISO: 1 = lunes … 7 = domingo. */
  diaSemana: number;
  esDiaLibre: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  horaInicioDescanso: string | null;
  horaFinDescanso: string | null;
}

export interface MiHorarioResponse {
  barberiaId: string;
  barberoId: string;
  /**
   * `true` cuando el barbero todavía no guardó nada en esta sede: el motor usa
   * el horario de la sede. Es la información que la pantalla necesita para
   * explicar de dónde salen las horas que está viendo.
   */
  heredaHorarioSede: boolean;
  dias: DiaHorarioBarberoResponse[];
}
