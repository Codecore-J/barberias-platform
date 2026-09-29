import { isDevMode } from '@angular/core';

export const API_URL = isDevMode()
  ? 'http://localhost:3000/api/v1'
  : 'https://barberias-api.onrender.com/api/v1';
