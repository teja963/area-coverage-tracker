interface Env {
  ROUTE_SHARES: KVNamespace
}

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60
const MAX_PAYLOAD_BYTES = 5_000_000
const APP_ORIGINS = new Set([
  'https://teja963.github.io',
  'https://area-coverage-tracker.panasateja123.workers.dev',
])

function isAllowedOrigin(origin: string | null) {
  return (
    !origin ||
    APP_ORIGINS.has(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  )
}

function responseHeaders(request: Request) {
  const origin = request.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  }
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }
  return headers
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  })
}

function isValidPayload(value: unknown): value is {
  version: number
  project: { track: unknown[]; zones: unknown[]; markers: unknown[] }
} {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  if (payload.version !== 1 || !payload.project || typeof payload.project !== 'object') {
    return false
  }
  const project = payload.project as Record<string, unknown>
  return (
    Array.isArray(project.track) &&
    project.track.length <= 100_000 &&
    Array.isArray(project.zones) &&
    project.zones.length <= 1_000 &&
    Array.isArray(project.markers) &&
    project.markers.length <= 10_000
  )
}

async function createShareCode(env: Env) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0]
    const code = String(100_000 + (random % 900_000))
    if (!(await env.ROUTE_SHARES.get(code))) return code
  }
  throw new Error('Could not allocate a route code')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAllowedOrigin(request.headers.get('Origin'))) {
      return json(request, { error: 'Origin not allowed' }, 403)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(request) })
    }

    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/routes') {
      const contentLength = Number(request.headers.get('Content-Length') || 0)
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return json(request, { error: 'Route history is too large to share' }, 413)
      }

      let payload: unknown
      try {
        payload = await request.json()
      } catch {
        return json(request, { error: 'Invalid route data' }, 400)
      }
      const encoded = JSON.stringify(payload)
      if (encoded.length > MAX_PAYLOAD_BYTES || !isValidPayload(payload)) {
        return json(request, { error: 'Invalid or oversized route data' }, 400)
      }

      try {
        const code = await createShareCode(env)
        const expiresAt = Date.now() + SHARE_TTL_SECONDS * 1000
        await env.ROUTE_SHARES.put(
          code,
          JSON.stringify({ payload, expiresAt }),
          { expirationTtl: SHARE_TTL_SECONDS },
        )
        return json(request, { code, expiresAt }, 201)
      } catch {
        return json(request, { error: 'Route sharing is temporarily unavailable' }, 503)
      }
    }

    const match = url.pathname.match(/^\/routes\/(\d{6})$/)
    if (request.method === 'GET' && match) {
      const stored = await env.ROUTE_SHARES.get(match[1], 'json') as {
        payload: unknown
        expiresAt: number
      } | null
      if (!stored) return json(request, { error: 'Code not found or expired' }, 404)
      return json(request, stored)
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return json(request, { service: 'Coverly route transfer', retentionDays: 7 })
    }
    return json(request, { error: 'Not found' }, 404)
  },
}
