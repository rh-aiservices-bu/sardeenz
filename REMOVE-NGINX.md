# Plan: Remove NGINX and Serve Static Files from Backend

## Summary

Simplify the container architecture by removing NGINX and having the Fastify backend serve the React frontend's static files directly. This reduces container complexity from 2 processes to 1.

## Rationale

- **Simpler architecture**: Single process instead of NGINX + Node.js
- **Easier debugging**: One log stream instead of two
- **Reduced container size**: No NGINX installation (~10-20MB)
- **Adequate performance**: Static file serving is not the bottleneck; GPU inference is

## Files to Modify

| File | Changes |
|------|---------|
| `apps/backend/package.json` | Add `@fastify/static` dependency |
| `apps/backend/src/server.ts` | Register static file plugin with SPA fallback |
| `docker/Dockerfile.unified` | Remove NGINX, adjust paths, change exposed port |
| `docker/entrypoint.sh` | Remove NGINX startup, simplify to single command |
| `docker/nginx.conf` | Delete file (no longer needed) |

## Implementation Steps

### Step 1: Add @fastify/static dependency

```bash
npm install @fastify/static -w apps/backend
```

### Step 2: Update `apps/backend/src/server.ts`

Add static file serving after route registration:

```typescript
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ... existing imports and route registrations ...

// Static file serving for frontend (production only)
if (config.nodeEnv === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const frontendPath = path.resolve(__dirname, '../../frontend/dist')

  await fastify.register(import('@fastify/static'), {
    root: frontendPath,
    prefix: '/',
    decorateReply: false, // Avoid conflict if already decorated
  })

  // SPA fallback: serve index.html for non-API routes
  fastify.setNotFoundHandler(async (request, reply) => {
    // Only serve index.html for non-API/non-v1 routes
    if (!request.url.startsWith('/api/') &&
        !request.url.startsWith('/v1/') &&
        !request.url.startsWith('/docs') &&
        !request.url.startsWith('/metrics')) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Not Found' })
  })
}
```

### Step 3: Update `apps/backend/src/config.ts`

Add `nodeEnv` to config if not present:

```typescript
nodeEnv: process.env.NODE_ENV || 'development',
```

### Step 4: Update `docker/Dockerfile.unified`

Remove NGINX-related lines and adjust:

```dockerfile
# Remove line 96:
# RUN microdnf install -y nginx && microdnf clean all

# Remove lines 108-110:
# COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# RUN mkdir -p /var/www/html && \
#     cp -r apps/frontend/dist /var/www/html

# Change line 120 from:
# EXPOSE 3000 80
# To:
EXPOSE 3000

# Keep frontend dist copy (line 105), it's still needed:
COPY --from=builder /app/apps/frontend/dist ./apps/frontend/dist
```

### Step 5: Simplify `docker/entrypoint.sh`

```bash
#!/bin/bash
set -e

cd /app
exec node apps/backend/dist/server.js
```

### Step 6: Delete `docker/nginx.conf`

File is no longer needed.

### Step 7: Update documentation

Update `docs/deployment.md` to reflect:
- Single port (3000) instead of 80/3000
- Simplified architecture diagram
- Remove NGINX references

## Testing Checklist

- [ ] Build container: `docker build -f docker/Dockerfile.unified -t sardeenz .`
- [ ] Run container: `docker run --gpus all -p 3000:3000 sardeenz`
- [ ] Verify frontend loads at `http://localhost:3000`
- [ ] Verify SPA routing works (navigate to `/models`, refresh page)
- [ ] Verify API routes work (`/api/health`, `/api/models`)
- [ ] Verify inference proxy works (`/v1/models`)
- [ ] Verify Swagger docs load (`/docs`)
- [ ] Verify metrics endpoint works (`/metrics`)

## Rollback

If issues arise, revert all changes. NGINX approach is preserved in git history.
