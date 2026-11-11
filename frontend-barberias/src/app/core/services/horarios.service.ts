import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../constants/api.constants';
import { Observable, of, throwError } from 'rxjs';
import { SIN_SEDE_ACTIVA } from '../utils/sin-sede';

export interface Horario {
  id?: string;
  diaSemana: number; // ISO: 1 (Lunes) a 7 (Domingo)
  horaInicio: string; // HH:mm
  horaFin: string; // HH:mm
}

/**
 * V3 fase 5 · un día de la semana propia del barbero.
 *
 * Las horas llegan ya como `HH:mm` (el backend las normaliza desde el `TIME` de
 * Postgres), que es el único formato que acepta un `<input type="time">`.
 */
export interface DiaHorarioBarbero {
  diaSemana: number; // ISO: 1 = lunes … 7 = domingo
  esDiaLibre: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  horaInicioDescanso: string | null;
  horaFinDescanso: string | null;
}

export interface MiHorarioSemana {
  barberiaId: string;
  barberoId: string;
  /** `true` si el barbero aún no guardó nada: el motor usa el horario de la sede. */
  heredaHorarioSede: boolean;
  dias: DiaHorarioBarbero[];
}

export interface ExcepcionHorario {
  id?: string;
  fecha: string; // YYYY-MM-DD
  tipo: 'CERRADA' | 'HORARIO_ESPECIAL';
  horaInicio?: string;
  horaFin?: string;
  motivo?: string;
}

/**
 * V3 · un día de la PLANTILLA BASE semanal del barbero.
 *
 * Es global (no cuelga de una sede): la semana que el barbero declara una vez y
 * el motor usa como fuente por defecto cuando no tiene horario propio en la
 * sede consultada. `diaSemana` es ISO 1 = lunes … 7 = domingo.
 */
export interface DiaPlantillaBase {
  diaSemana: number;
  /** `null` cuando el barbero nunca configuró ese día. */
  horaInicio: string | null;
  horaFin: string | null;
  /** Un día sin bloque (`horaInicio` nulo) siempre llega en `false`. */
  activo: boolean;
}

export interface PlantillaBaseSemana {
  barberoId: string;
  /** `true` si el barbero todavía no guardó ninguna plantilla. */
  sinPlantilla: boolean;
  /** Los siete días, con los no configurados en `null`. */
  dias: DiaPlantillaBase[];
}

/**
 * V3 · excepción del barbero para UNA fecha concreta.
 *
 * El backend no acepta rangos (`fechaInicio`/`fechaFin`): cada día distinto es
 * una excepción propia, que es como la guarda `excepciones_horario_barbero`
 * (`UNIQUE (barbero, barbería, fecha)`).
 */
export interface NuevaExcepcionBarbero {
  fecha: string; // YYYY-MM-DD
  tipo: 'CERRADA' | 'HORARIO_ESPECIAL';
  horaInicio?: string;
  horaFin?: string;
  motivo?: string;
}

export interface BloqueoAgenda {
  id: string;
  barberiaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  motivo?: string;
  creadoPor?: string;
  jobId?: string;
  createdAt?: string;
}

export interface CreateBloqueoDto {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  motivo?: string;
  liberacionAutomaticaMinutos?: number;
}

@Injectable({
  providedIn: 'root'
})
export class HorariosService {
  private http = inject(HttpClient);

  /**
   * Sin sede no se construye la URL: interpolar `null` producía
   * `/shops/null/hours` y un 400 con la ruta técnica en pantalla.
   */
  private tieneSede(barberiaId: string | null | undefined): barberiaId is string {
    return typeof barberiaId === 'string' && barberiaId.trim().length > 0;
  }

  private sinSedeError(): Error {
    return new Error(SIN_SEDE_ACTIVA);
  }

  obtenerHorarios(barberiaId: string): Observable<Horario[]> {
    if (!this.tieneSede(barberiaId)) return of([]);
    return this.http.get<Horario[]>(`${API_URL}/shops/${barberiaId}/hours`);
  }

  configurarHorarios(barberiaId: string, horarios: Omit<Horario, 'id'>[]): Observable<Horario[]> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.post<Horario[]>(`${API_URL}/shops/${barberiaId}/hours`, horarios);
  }

  /** Semana propia del barbero (días libres y descansos). */
  obtenerMiSemana(barberiaId: string): Observable<MiHorarioSemana> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.get<MiHorarioSemana>(`${API_URL}/shops/${barberiaId}/mi-horario`);
  }

  /**
   * `PUT` porque reemplaza la semana completa: repetir el guardado deja el mismo
   * estado y nunca duplica filas. El `barberoId` lo pone el backend desde el JWT.
   */
  guardarMiSemana(barberiaId: string, dias: DiaHorarioBarbero[]): Observable<MiHorarioSemana> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.put<MiHorarioSemana>(`${API_URL}/shops/${barberiaId}/mi-horario`, {
      dias,
    });
  }

  /**
   * Plantilla base semanal del barbero autenticado.
   *
   * Bajo `shops/:shopId` porque la sede es lo que autoriza la llamada; la
   * plantilla en sí es del barbero y el `barberoId` lo pone el backend desde el
   * JWT, nunca el cliente.
   */
  obtenerPlantillaBase(barberiaId: string): Observable<PlantillaBaseSemana> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.get<PlantillaBaseSemana>(`${API_URL}/shops/${barberiaId}/mi-horario/base`);
  }

  /**
   * Guardado MASIVO de la plantilla: solo se envían los días que cambian.
   *
   * Es un upsert por día, no un reemplazo: el backend conserva los días que no
   * viajan en el cuerpo (y las horas de un día que se apaga).
   */
  guardarPlantillaBase(
    barberiaId: string,
    dias: DiaPlantillaBase[],
  ): Observable<PlantillaBaseSemana> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.put<PlantillaBaseSemana>(`${API_URL}/shops/${barberiaId}/mi-horario/base`, {
      dias,
    });
  }

  /**
   * Excepción del barbero para una fecha (día libre o jornada especial).
   *
   * El `barberoId` va en la ruta porque el backend lo exige para autorizar: si
   * no coincide con el usuario del token, solo un administrador de la sede puede
   * escribirla (403 en caso contrario).
   */
  crearExcepcionBarbero(
    barberiaId: string,
    barberoId: string,
    excepcion: NuevaExcepcionBarbero,
  ): Observable<ExcepcionHorario> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.post<ExcepcionHorario>(
      `${API_URL}/shops/${barberiaId}/hours/barbers/${barberoId}/exceptions`,
      excepcion,
    );
  }

  obtenerExcepciones(barberiaId: string, from?: string, to?: string): Observable<ExcepcionHorario[]> {
    if (!this.tieneSede(barberiaId)) return of([]);
    let params: any = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return this.http.get<ExcepcionHorario[]>(`${API_URL}/shops/${barberiaId}/hours/exceptions`, { params });
  }

  agregarExcepcion(barberiaId: string, excepcion: ExcepcionHorario): Observable<ExcepcionHorario> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.post<ExcepcionHorario>(`${API_URL}/shops/${barberiaId}/hours/exceptions`, excepcion);
  }

  /**
   * Alias del nombre anterior. Conserva la firma que ya usaba la pantalla de
   * personal; la implementación es una sola (`crearExcepcionBarbero`), para que
   * cambiar la ruta o el cuerpo no obligue a tocar dos sitios.
   */
  agregarExcepcionBarbero(
    barberiaId: string,
    barberoId: string,
    excepcion: ExcepcionHorario,
  ): Observable<ExcepcionHorario> {
    return this.crearExcepcionBarbero(barberiaId, barberoId, excepcion);
  }

  obtenerBloqueos(barberiaId: string, from?: string, to?: string): Observable<BloqueoAgenda[]> {
    if (!this.tieneSede(barberiaId)) return of([]);
    let params: any = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return this.http.get<BloqueoAgenda[]>(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks`, { params });
  }

  crearBloqueo(barberiaId: string, bloqueo: CreateBloqueoDto): Observable<BloqueoAgenda> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.post<BloqueoAgenda>(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks`, bloqueo);
  }

  /**
   * E2-07: el bloqueo no se borra, se LIBERA (`POST .../blocks/:id/release`).
   * El método conserva su nombre porque lo que hace la pantalla no cambió: el
   * bloqueo deja de ocupar la agenda. Lo que cambia es el verbo del backend.
   */
  eliminarBloqueo(barberiaId: string, id: string): Observable<any> {
    if (!this.tieneSede(barberiaId)) return throwError(() => this.sinSedeError());
    return this.http.post(`${API_URL}/shops/${barberiaId}/appointments/schedule/blocks/${id}/release`, {});
  }
}

