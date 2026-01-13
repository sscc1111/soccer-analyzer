# Multi-stage build for smaller final image
FROM node:20-slim AS builder

# Install FFmpeg and build dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files for dependency installation
COPY packages/shared/package.json ./packages/shared/
COPY services/analyzer/package.json ./services/analyzer/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY services/analyzer/ ./services/analyzer/

# Build packages
RUN pnpm --filter @soccer/shared build
RUN pnpm --filter @soccer/analyzer build

# Production stage
FROM node:20-slim

# Install FFmpeg only (runtime dependency)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files
COPY packages/shared/package.json ./packages/shared/
COPY services/analyzer/package.json ./services/analyzer/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder stage
COPY --from=builder /app/services/analyzer/dist ./services/analyzer/dist

# Copy runtime files
COPY services/analyzer/server.js ./services/analyzer/
COPY services/analyzer/src/gemini/prompts ./src/gemini/prompts

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080
ENV ML_INFERENCE_URL=https://ml-inference-539846821742.us-central1.run.app

# Expose Cloud Run default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the analyzer service
CMD ["node", "services/analyzer/server.js"]
