# syntax=docker/dockerfile:1.7
# Next.js standalone production image with non-root user and healthcheck.
#
# Build context: project root (so paths resolve like the dev workflow).
# Runtime env: DATABASE_*, JWT_*, ADMIN_JWT_SECRET, VENDOR_JWT_SECRET,
# NEXT_PUBLIC_SUPABASE_* — injected by docker-compose / orchestrator from
# .env.local. NEVER bake secrets into the image.

FROM node:22-alpine AS deps
WORKDIR /app
# Copy only the manifest files first so a source-only change doesn't
# bust the npm install cache layer.
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder NEXT_PUBLIC_* values so the build doesn't crash on undefined.
# Real values are injected at runtime by the orchestrator / platform.
RUN echo 'NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co' >> .env.docker && \
    echo 'NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key' >> .env.docker && \
    cp .env.docker .env.local
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user (security baseline — many prod platforms refuse root).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Production-only deps; mirrors `npm ci --omit=dev` behaviour but skips
# the workspace scripts we don't need at runtime.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --legacy-peer-deps || npm install --omit=dev --legacy-peer-deps

# Rebuild sharp against the runtime platform (node:22-alpine / musl).
# Without this, the prebuilt `@img/sharp-*` binary downloaded by npm can
# be silently incompatible with the container's glibc/musl ABI, causing
# `/_next/image` to hang (request never returns) — which is exactly
# what makes every optimized image (logo, banners, product thumbs) invisible.
RUN npm rebuild sharp

# App + scripts (migrate runner, qa scripts) so operators can run
# `docker exec <app> npm run db:migrate` without rebuilding.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# Ensure runtime writable upload dirs exist with correct ownership.
# `COPY --chown` only chowns files placed in the image, not directories
# created at runtime by the Next.js route. Run this as root *before*
# switching to USER nextjs so the non-root user can actually write here.
RUN mkdir -p /app/public/images/employment \
            /app/public/uploads/voice \
 && chown -R nextjs:nodejs /app/public/images/employment /app/public/uploads/voice \
 && chmod 775 /app/public/images/employment /app/public/uploads/voice
# Next.js writes optimized-image cache into `.next/cache/images/<hash>`
# at runtime. The builder ran as root so the parent is owned by root,
# and `chown -R` on a COPY only fixes the *files* copied — subdirs
# next.js creates later stay root-owned and `nextjs` then can't write.
# Reassign the entire cache tree to nextjs so optimized images can be
# cached without `EACCES: permission denied, mkdir
# '/app/.next/cache/images/<hash>'` errors.
RUN chown -R nextjs:nodejs /app/.next/cache \
 && chmod -R u+rwX /app/.next/cache
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=nextjs:nodejs /app/tailwind.config.ts ./
# `postcss.config.mjs` is required at runtime (Tailwind/PostCSS loader).
# The previous `... 2>/dev/null || true` shell-fallback breaks BuildKit
# cache-key parsing, so the rebuild fails once the cache is invalidated.
# The file is checked in (postcss.config.mjs) — copy it unconditionally.
COPY --from=builder --chown=nextjs:nodejs /app/postcss.config.mjs ./postcss.config.mjs

USER nextjs
EXPOSE 3000

# Liveness probe. /api/health responds cheaply; we hit it from the
# orchestrator. If the proxy or auth flow regresses to a 5xx here the
# container is replaced.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/api/health" \
    || exit 1

# Use exec form so SIGTERM reaches the Node process directly (shell
# form would swallow signals via the npm wrapper and prevent graceful
# shutdown — k8s rolling deploys stall on this).
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -p ${PORT:-3000} -H 0.0.0.0"]
