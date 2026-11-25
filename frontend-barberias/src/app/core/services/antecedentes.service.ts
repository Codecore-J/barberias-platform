import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export type EstadoSolicitudAntecedente = 'PENDIENTE' | 'APROBADA' | 'DENEGADA';

export interface Antecedente {
  id: string;
  clienteId: string;
  barberoId: string;
  descripcion: string;
  severidad: string;
  estado: string;
  creadoAt: string;
  cliente?: { nombreCompleto: string };
  barbero?: { nombreCompleto: string };
}

/** F5 · cliente que el formulario puede ofrecer (ya pasó por la sede). */
export interface ClienteElegible {
  id: string;
  nombreCompleto: string;
  correo: string;
}

export interface SolicitudAntecedente {
  id: string;
  barberiaId: string;
  solicitanteId: string;
  clienteId: string;
  motivo: string;
  evidenciaTexto: string | null;
  estado: EstadoSolicitudAntecedente;
  resueltoPor: string | null;
  resueltoAt: string | null;
  motivoDenegacion: string | null;
  creadoAt: string;
  solicitante?: { id: string; nombreCompleto: string };
  cliente?: { id: string; nombreCompleto: string; correo: string };
  barberia?: { id: string; nombre: string };
}

export interface CrearSolicitudAntecedentePayload {
  clienteId: string;
  motivo: string;
  evidenciaTexto?: string;
}

export interface AntecedenteDeCliente {
  id: string | null;
  categoria: string;
  contenido: string;
  estadoValidacion: string;
  creadoAt: string;
  origenBarberia?: 'PROPIA' | 'EXTERNA';
}

@Injectable({
  providedIn: 'root'
})
export class AntecedentesService {
  private readonly http = inject(HttpClient);

  // ── Flujo anterior (registros evaluados por la sede) ──────────────────────
  obtenerPendientes(barberiaId: string): Observable<Antecedente[]> {
    return this.http.get<Antecedente[]>(`${API_URL}/shops/${barberiaId}/records/pending`);
  }

  evaluar(barberiaId: string, antecedenteId: string, decision: 'APROBADO' | 'RECHAZADO', motivoRechazo?: string): Observable<any> {
    return this.http.patch(`${API_URL}/shops/${barberiaId}/records/${antecedenteId}/evaluate`, {
      decision,
      motivoRechazo
    });
  }

  // ── F5 · solicitud → decisión de la plataforma ────────────────────────────
  crearSolicitud(barberiaId: string, payload: CrearSolicitudAntecedentePayload): Observable<SolicitudAntecedente> {
    return this.http.post<SolicitudAntecedente>(
      `${API_URL}/shops/${barberiaId}/antecedentes/solicitudes`,
      payload,
    );
  }

  listarSolicitudes(barberiaId: string, estado?: EstadoSolicitudAntecedente): Observable<SolicitudAntecedente[]> {
    const query = estado ? `?estado=${estado}` : '';
    return this.http.get<SolicitudAntecedente[]>(
      `${API_URL}/shops/${barberiaId}/antecedentes/solicitudes${query}`,
    );
  }

  listarClientesElegibles(barberiaId: string): Observable<ClienteElegible[]> {
    return this.http.get<ClienteElegible[]>(
      `${API_URL}/shops/${barberiaId}/antecedentes/clientes`,
    );
  }

  listarSolicitudesPendientesGlobal(): Observable<SolicitudAntecedente[]> {
    return this.http.get<SolicitudAntecedente[]>(`${API_URL}/antecedentes/solicitudes`);
  }

  resolverSolicitud(
    solicitudId: string,
    decision: 'APROBAR' | 'DENEGAR',
    motivo?: string,
  ): Observable<SolicitudAntecedente> {
    return this.http.patch<SolicitudAntecedente>(
      `${API_URL}/antecedentes/solicitudes/${solicitudId}`,
      { decision, motivo },
    );
  }

  obtenerAntecedentesDeCliente(barberiaId: string, clienteId: string): Observable<AntecedenteDeCliente[]> {
    return this.http.get<AntecedenteDeCliente[]>(
      `${API_URL}/shops/${barberiaId}/records/client/${clienteId}`,
    );
  }
}
