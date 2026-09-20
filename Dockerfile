FROM oven/bun:1.3.14 AS bun
FROM node:22-bookworm-slim AS node
FROM python:3.13-slim-bookworm

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgomp1 tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY client-frontend/package.json client-frontend/
COPY admin-frontend/package.json admin-frontend/
COPY packages/audio/package.json packages/audio/
COPY packages/contracts/package.json packages/contracts/
COPY packages/selection/package.json packages/selection/
COPY packages/sync/package.json packages/sync/
COPY packages/testkit/package.json packages/testkit/
RUN bun install --frozen-lockfile

COPY workers/otc/requirements-dev.lock workers/otc/requirements-dev.lock
RUN python -m venv .venv \
    && .venv/bin/python -m pip install --no-cache-dir -r workers/otc/requirements-dev.lock
COPY . .
RUN .venv/bin/python -m pip install --no-cache-dir --no-deps -e ./workers/otc

ARG SESSION_ID=prod-session
ARG NEXT_PUBLIC_PARTICIPANT_URL
ENV NODE_ENV=production SESSION_ID=${SESSION_ID} DATA_DIR=/data PORT=3000 \
    PYTHON=/app/.venv/bin/python \
    BACKEND_INTERNAL_URL=http://127.0.0.1:8080 ADMIN_INTERNAL_URL=http://127.0.0.1:3001
RUN NEXT_PUBLIC_SESSION_ID=${SESSION_ID} NEXT_PUBLIC_PARTICIPANT_URL=${NEXT_PUBLIC_PARTICIPANT_URL} \
    bun run build \
    && .venv/bin/python -m otc --help

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["bun", "run", "start"]
