import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

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

@Injectable({
  providedIn: 'root'
})
export class AntecedentesService {
  private readonly http = inject(HttpClient);

  obtenerPendientes(barberiaId: string): Observable<Antecedente[]> {
    return this.http.get<Antecedente[]>(`${API_URL}/barberias/${barberiaId}/antecedentes/pendientes`);
  }

  evaluar(barberiaId: string, antecedenteId: string, decision: 'APROBADO' | 'RECHAZADO', motivoRechazo?: string): Observable<any> {
    return this.http.patch(`${API_URL}/barberias/${barberiaId}/antecedentes/${antecedenteId}/evaluar`, {
      decision,
      motivoRechazo
    });
  }
}
