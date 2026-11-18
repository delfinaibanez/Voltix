# inventory-service - imagen de producción
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Primero solo las dependencias: si no cambia package*.json, Docker reutiliza esta capa.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
# Scripts de demostración (race-demo.js)
COPY --chown=node:node scripts ./scripts

# Carpeta de logs con permisos para el usuario sin privilegios.
RUN mkdir -p logs && chown node:node logs

# No correr como root.
USER node

# HTTP interno (red de Docker). HTTPS se configura con HTTPS_PORT (3443 en compose).
EXPOSE 3000

# Healthcheck con node + fetch nativo (la imagen alpine no trae curl).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
