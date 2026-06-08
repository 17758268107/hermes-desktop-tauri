/**
 * Hermes Workspace — Bun.serve SSR entry
 *
 * Drop-in replacement for the Node-based `server-entry.js`. Used in two modes:
 *
 *   1. Development  — `bun run dev:server` (Bun serves Vite's built client/
 *      server output on the same loopback port the Tauri webview loads from)
 *   2. Production   — `bun run start` (Bun serves the prebuilt `dist/client/`
 *      and `dist/server/server.js` produced by `bun run build`)
 *
 * Bun is the runtime + the bundler. We deliberately *don't* run Vite inside
 * this process — Vite's dev server (port 3000) is what the Tauri webview
 * actually talks to. This Bun server is for the packaged app case where
 * the Vite dev server is not present.
 */

import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const __dirname = new URL('.', import.meta.url).pathname
const CLIENT_DIR = join(__dirname, 'dist', 'client')
const SERVER_BUNDLE = join(__dirname, 'dist', 'server', 'server.js')

const port = Number.parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '127.0.0.1'

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
}

async function loadServerBuild(): Promise<(req: Request) => Promise<Response>> {
  if (!existsSync(SERVER_BUNDLE)) {
    throw new Error(
      `Server bundle not found at ${SERVER_BUNDLE}. Run 'bun run build' first.`,
    )
  }
  const mod = await import(SERVER_BUNDLE)
  const handler = (mod as { default?: unknown }).default ?? mod
  if (typeof handler !== 'function' && typeof (handler as { fetch?: unknown }).fetch !== 'function') {
    throw new Error('Server bundle must export a default function or { fetch }')
  }
  return (handler as { fetch?: (req: Request) => Promise<Response> }).fetch
    ?? (handler as (req: Request) => Promise<Response>)
}

async function tryServeStatic(pathname: string): Promise<Response | null> {
  if (pathname.includes('..')) return null
  const filePath = join(CLIENT_DIR, pathname)
  if (!filePath.startsWith(CLIENT_DIR)) return null

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return null
  } catch {
    return null
  }

  const ext = extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  const data = await readFile(filePath)
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': data.length.toString(),
  }
  if (pathname.startsWith('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  }
  return new Response(data, { status: 200, headers })
}

async function requestHandler(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (req.method === 'GET' || req.method === 'HEAD') {
    const served = await tryServeStatic(url.pathname)
    if (served) return served
  }

  try {
    const handler = await getHandler()
    return await handler(req)
  } catch (err) {
    console.error('[server-bun] SSR error:', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}

let cachedHandler: ((req: Request) => Promise<Response>) | null = null
async function getHandler(): Promise<(req: Request) => Promise<Response>> {
  if (cachedHandler) return cachedHandler
  cachedHandler = await loadServerBuild()
  return cachedHandler
}

const server = Bun.serve({
  port,
  hostname: host,
  reusePort: true,
  development: process.env.NODE_ENV !== 'production',
  async fetch(req) {
    return requestHandler(req)
  },
  error(err) {
    console.error('[server-bun] unhandled:', err)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`[hermes-workspace] Bun.serve listening on http://${host}:${server.port}`)

const shutdown = (signal: string) => {
  console.log(`[hermes-workspace] received ${signal}, shutting down...`)
  server.stop()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
