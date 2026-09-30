import { isDevMode } from '@angular/core';

export const API_URL = isDevMode()
  ? 'http://localhost:3000/api/v1'
  : 'https://barberias-api-p3br.onrender.com/api/v1';
