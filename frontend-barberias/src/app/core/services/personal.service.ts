import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../constants/api.constants';
import { Observable } from 'rxjs';

export interface Personal {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string;
  estado: string;
  roles: string[];
}

@Injectable({
  providedIn: 'root'
})
export class PersonalService {
  private http = inject(HttpClient);

  obtenerPersonal(barberiaId: string): Observable<Personal[]> {
    return this.http.get<Personal[]>(`${API_URL}/barberias/${barberiaId}/personal`);
  }
}
