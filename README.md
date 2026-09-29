# Plataforma de Barberías — Monorepo

Monorepo que contiene el backend (NestJS) y frontend (Angular) de la plataforma de gestión de barberías.

## Estructura

```
barberias-platform/
├── backend-barberias/   # API REST — NestJS + Prisma + PostgreSQL (Neon)
├── frontend-barberias/  # SPA — Angular 22 + PrimeNG + Tailwind CSS
└── docs/                # Documentación técnica y plan estratégico
```

## Comandos desde la raíz

> Todos los comandos se ejecutan desde `barberias-platform/`

### Desarrollo
```bash
# Solo frontend (http://localhost:4200)
npm start

# Solo backend (http://localhost:3000)
npm run start:backend

# Ambos en ventanas separadas (Windows)
npm run start:all
```

### Build
```bash
npm run build           # Compila ambos proyectos
npm run build:backend   # Solo backend
npm run build:frontend  # Solo frontend
```

### Testing
```bash
npm run test        # Tests unitarios del backend
npm run test:e2e    # Tests E2E del backend
```

### Base de datos
```bash
npm run db:migrate   # Ejecuta migraciones de Prisma
npm run db:studio    # Abre Prisma Studio
```

## Requisitos previos

- Node.js >= 20.0.0
- npm >= 10.0.0
- Archivo `.env` en `backend-barberias/` con `DATABASE_URL` y `JWT_SECRET`

## Variables de entorno (backend)

```env
DATABASE_URL="postgresql://..."   # Neon Postgres connection string
JWT_SECRET="tu_secreto_jwt"
NODE_ENV="development"
```
