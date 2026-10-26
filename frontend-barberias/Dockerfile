# syntax=docker/dockerfile:1
#
# SPA Angular + nginx · contenerización multi-stage (Paso 17).
#
# El contexto de build es la RAÍZ del monorepo (npm workspaces), igual que el
# backend:
#
#   docker build -f frontend-barberias/Dockerfile .
#
# Etapa 1 · construcción ------------------------------------------------------
# node:24 (LTS) porque Angular CLI 22 exige Node >= 22.22.3 / 24.15.0; el
# backend sí vive en node:20, como dicta el paso 17.
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend-barberias/package.json ./backend-barberias/package.json
COPY frontend-barberias/package.json ./frontend-barberias/package.json
RUN npm ci

# `public/` (assets estáticos) viaja dentro de frontend-barberias/. La salida
# del builder de aplicaciones es dist/frontend-barberias/browser (la misma que
# usa vercel.json como outputDirectory).
COPY frontend-barberias ./frontend-barberias
RUN npm run build:frontend

# Etapa 2 · nginx sirviendo los estáticos -------------------------------------
FROM nginx:alpine AS production

# Configuración propia: SPA con fallback a index.html (ver nginx.conf).
COPY frontend-barberias/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend-barberias/dist/frontend-barberias/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]