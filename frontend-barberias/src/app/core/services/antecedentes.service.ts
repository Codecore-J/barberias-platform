import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export type EstadoSolicitudAntecedente = 'PENDIENTE' | 'APROBADA' | 'DENEGADA';

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

@Injectable({
  providedIn: 'root'
})
export class AntecedentesService {
  private readonly http = inject(HttpClient);

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
}
