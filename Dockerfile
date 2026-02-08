FROM node:20-alpine

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY server/ ./server/
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY components.json ./

# Build frontend with production API URL
ENV VITE_API_URL="https://new.mejmosefajn.org"
RUN npx vite build

# Create data directory for SQLite
RUN mkdir -p data server/uploads

# Remove build tools (keep all npm deps - tsx needed at runtime)
RUN apk del python3 make g++

EXPOSE 3001

CMD ["node", "--import", "tsx", "server/index.ts"]
