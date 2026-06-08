/**
 * Hermes Workspace — Tauri 2 + Bun desktop bridge
 *
 * Surfaces the `window.hermesDesktop.*` API for the React app. Frontend code
 * that calls `window.hermesDesktop.*` works unchanged across webview contexts;
 * under the hood this module dispatches the calls to Tauri commands. In a
 * plain browser context (Vite dev preview, CI smoke tests) the bridge degrades
 * to no-op stubs so the React app still mounts.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'

type DesktopStatus = {
  ok: boolean
  platform: string
  version: string
  hermesInstalled: boolean
  gatewayReachable: boolean
  dashboardReachable: boolean
  installerRunning: boolean
  spawned: Array<string>
  settingsComplete: boolean
  gateway?: unknown
  dashboard?: unknown
}

type PortStatusItem = {
  id: string
  label: string
  host: string
  port: number
  url: string
  inUse: boolean
  reachable: boolean
  status: number
  error: string
}

type PortStatus = {
  ok: boolean
  checkedAt: number
  ports: Array<PortStatusItem>
}

type UpdateState = {
  checking: boolean
  available: boolean
  downloaded: boolean
  error: string | null
  version: string
  latestVersion?: string | null
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!inTauri()) return null
  try {
    return (await invoke(cmd, args)) as T
  } catch (err) {
    console.warn(`[hermesDesktop] ${cmd} failed:`, err)
    return null
  }
}

const updateListeners = new Map<(state: UpdateState) => void, UnlistenFn>()

async function ensureUpdateListener(): Promise<void> {
  if (updateListeners.size > 0) return
  if (!inTauri()) return
  const unlisten = await listen<UpdateState>('update:state', (event) => {
    for (const cb of updateListeners.keys()) {
      try {
        cb(event.payload)
      } catch (err) {
        console.warn('[hermesDesktop] update listener error:', err)
      }
    }
  })
  updateListeners.set(() => undefined, unlisten)
}

export const hermesDesktop = {
  bootstrap: {
    status: () => safeInvoke<DesktopStatus>('desktop_status'),
    installHermes: () => safeInvoke<{ ok: boolean; started: boolean; pid?: number; logPath?: string }>('install_hermes'),
    startBackend: () =>
      safeInvoke<{
        ok: boolean
        installed: boolean
        gatewayStarted: boolean
        dashboardStarted: boolean
        gatewayReachable: boolean
        dashboardReachable: boolean
      }>('start_backend'),
    openLogs: () => safeInvoke<{ ok: boolean; path: string }>('open_logs'),
  },
  gateway: {
    health: (url: string) => safeInvoke<unknown>('gateway_health', { gatewayUrl: url }),
    status: (url: string) => safeInvoke<unknown>('gateway_status', { gatewayUrl: url }),
    request: (path: string, init: unknown, gatewayUrl: string) =>
      safeInvoke<unknown>('gateway_request', { path, init, gatewayUrl }),
    sendStream: (body: unknown, gatewayUrl: string) =>
      safeInvoke<unknown>('send_stream', { body, gatewayUrl }),
    claudeConfigGet: () => safeInvoke<unknown>('claude_config_get'),
    claudeConfigPatch: (body: unknown) =>
      safeInvoke<unknown>('claude_config_patch', { body }),
  },
  diagnostics: {
    ports: () => safeInvoke<PortStatus>('workspace_port_status'),
  },
  updates: {
    check: () => safeInvoke<{ ok: boolean; error?: string }>('update_check'),
    install: () => safeInvoke<{ ok: boolean; error?: string }>('update_install'),
    getState: () => safeInvoke<UpdateState>('update_state'),
    onStateChange: async (callback: (state: UpdateState) => void): Promise<UnlistenFn | null> => {
      if (!inTauri()) return null
      updateListeners.set(callback, () => undefined)
      await ensureUpdateListener()
      // Replace the placeholder with the real unlistener for this callback.
      const unlisten = await listen<UpdateState>('update:state', (event) => {
        // Only invoke the registered callbacks, not the placeholder.
        for (const [cb, un] of updateListeners) {
          if (cb === callback) {
            try {
              cb(event.payload)
            } catch (err) {
              console.warn('[hermesDesktop] update listener error:', err)
            }
            void un
          }
        }
      })
      updateListeners.set(callback, unlisten)
      return unlisten
    },
    removeStateListener: async (callback: (state: UpdateState) => void) => {
      const unlisten = updateListeners.get(callback)
      if (unlisten) {
        unlisten()
        updateListeners.delete(callback)
      }
    },
  },
  app: {
    get version(): string {
      return APP_VERSION
    },
    platform: typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'unknown',
    isTauri: inTauri(),
  },
}

declare global {
  interface Window {
    hermesDesktop: typeof hermesDesktop
    __HERMES_TAURI__?: boolean
  }
}

const APP_VERSION = (typeof window !== 'undefined' && (window as { __HERMES_APP_VERSION__?: string }).__HERMES_APP_VERSION__) || '2.4.0'

/**
 * Default Hermes API Gateway URL — the local sidecar started by `start_backend`.
 * The Tauri 2 webview runs at `tauri://localhost` (or `http://tauri.localhost`),
 * which means the browser treats `http://127.0.0.1:8642` as a cross-origin
 * request. The gateway doesn't ship CORS headers, so a direct `fetch()` from
 * the renderer is blocked. We solve it by routing every same-origin `/api/*`
 * fetch through the Tauri `gateway_request` command, which uses `reqwest` on
 * the Rust side and bypasses the webview's CORS check entirely.
 *
 * Keep this in sync with `DEFAULT_GATEWAY_URL` in `src-tauri/src/lib.rs`.
 */
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8642'

function isTauriApiTarget(rawUrl: string): { ok: true; path: string } | { ok: false } {
  if (!rawUrl) return { ok: false }
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
  let pathname = ''
  let search = ''
  if (isAbsolute) {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return { ok: false }
    }
    // Only intercept same-origin renderer fetches; let cross-origin URLs
    // (e.g. https://api.openai.com, https://api.anthropic.com) hit the real
    // browser fetch and let the webview's normal CORS handling apply.
    if (parsed.origin !== window.location.origin) return { ok: false }
    pathname = parsed.pathname
    search = parsed.search
  } else {
    // Relative or path-only URL: only intercept if it points at our /api/*
    const qIndex = rawUrl.indexOf('?')
    pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)
    search = qIndex === -1 ? '' : rawUrl.slice(qIndex)
    if (!pathname.startsWith('/api/') && pathname !== '/api') {
      return { ok: false }
    }
  }
  if (!pathname.startsWith('/api/')) return { ok: false }
  return { ok: true, path: pathname + search }
}

function installFetchInterceptor(gatewayUrl: string): void {
  if (!inTauri()) return
  const realFetch = window.fetch.bind(window)
  const override = async function fetchViaTauri(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const matched = isTauriApiTarget(rawUrl)
    if (!matched.ok) return realFetch(input as RequestInfo, init)

    // Extract method and body early so special-cases can use them.
    const method =
      init?.method ??
      (typeof input !== 'string' && !(input instanceof URL)
        ? input.method
        : undefined) ??
      'GET'
    let body: string | undefined
    if (init?.body != null) {
      body =
        typeof init.body === 'string'
          ? init.body
          : init.body instanceof FormData ||
              init.body instanceof Blob ||
              init.body instanceof ArrayBuffer ||
              init.body instanceof URLSearchParams
            ? undefined
            : JSON.stringify(init.body)
    }

    // Special-case `/api/send-stream`: the desktop bundle has no TanStack
    // server route, and Hermes Agent's :8642 gateway does not implement
    // Workspace's `/api/send-stream`. Route it to Rust, call
    // `/v1/chat/completions`, then synthesize the SSE events the chat UI
    // already knows how to consume.
    if (matched.path === '/api/send-stream') {
      const upperMethod = (method || 'GET').toUpperCase()
      if (upperMethod !== 'POST') return realFetch(input as RequestInfo, init)

      let parsed: unknown = body
      if (typeof body === 'string' && body.length > 0) {
        try {
          parsed = JSON.parse(body)
        } catch {
          parsed = {}
        }
      }
      const result = (await hermesDesktop.gateway.sendStream(
        parsed ?? {},
        gatewayUrl,
      )) as
        | {
            ok: boolean
            data?: {
              text?: string
              runId?: string
              sessionKey?: string
              friendlyId?: string
            }
            error?: string
            status?: number
          }
        | null
      if (!result) return realFetch(input as RequestInfo, init)

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            )
          }
          if (!result.ok) {
            send('error', {
              error: result.error ?? 'Hermes request failed',
              status: result.status,
            })
            controller.close()
            return
          }
          const data = result.data ?? {}
          const runId =
            typeof data.runId === 'string' && data.runId.trim()
              ? data.runId
              : `desktop-${Date.now()}`
          const sessionKey =
            typeof data.sessionKey === 'string' && data.sessionKey.trim()
              ? data.sessionKey
              : 'main'
          const friendlyId =
            typeof data.friendlyId === 'string' && data.friendlyId.trim()
              ? data.friendlyId
              : sessionKey
          send('started', { runId, sessionKey, friendlyId })
          const text = typeof data.text === 'string' ? data.text : ''
          if (text) send('chunk', { text, fullReplace: true })
          send('done', { state: 'completed', runId, sessionKey })
          send('complete', { state: 'completed', runId, sessionKey })
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
      })
    }

    // Special-case `/api/gateway-status`: Hermes Agent (port 8642) doesn't
    // implement that endpoint, so we synthesise `{capabilities, claudeUrl}`
    // by actively probing the gateway's known routes (`/health`, `/v1/models`,
    // `/v1/chat/completions`, `/api/sessions`, `/api/tasks`). The Rust side
    // caches the result for 5 s so repeated polling from the onboarding flow
    // doesn't hammer the gateway.
    if (matched.path === '/api/gateway-status') {
      const result = (await hermesDesktop.gateway.status(gatewayUrl)) as
        | { ok: boolean; data?: unknown; error?: string }
        | null
      if (!result) return realFetch(input as RequestInfo, init)
      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: result.error ?? 'Gateway unreachable' }),
          {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      return new Response(JSON.stringify(result.data ?? {}), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    }

    // Special-case `/api/claude-config`: Hermes Agent's gateway (:8642) does
    // not expose the legacy enhanced-fork config endpoints, so the desktop
    // bridge reads `%LOCALAPPDATA%\hermes\config.yaml` + `.env` directly via
    // the Rust side and returns the same shape `handleHermesConfigGet` would
    // have produced. This keeps the in-app "Hermes Agent Settings" panel
    // functional without a running dashboard.
    if (matched.path === '/api/claude-config') {
      const upperMethod = (method || 'GET').toUpperCase()
      if (upperMethod === 'GET') {
        const result = (await hermesDesktop.gateway.claudeConfigGet()) as
          | { ok: boolean; data?: unknown; error?: string }
          | null
        if (!result) return realFetch(input as RequestInfo, init)
        if (!result.ok) {
          return new Response(
            JSON.stringify({
              error: result.error ?? 'Hermes config unavailable',
              ok: false,
            }),
            {
              status: 502,
              statusText: 'Bad Gateway',
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response(JSON.stringify(result.data ?? {}), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        })
      }

      // PATCH / POST: forward the body to the Rust patch handler.
      if (upperMethod === 'PATCH' || upperMethod === 'POST') {
        let parsed: unknown = body
        if (typeof body === 'string' && body.length > 0) {
          try {
            parsed = JSON.parse(body)
          } catch {
            // Leave as the raw string; the Rust side will surface a 400.
          }
        }
        const result = (await hermesDesktop.gateway.claudeConfigPatch(parsed)) as
          | { ok: boolean; message?: string; error?: string }
          | null
        if (!result) return realFetch(input as RequestInfo, init)
        if (!result.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: result.error ?? 'Patch failed',
            }),
            {
              status: 400,
              statusText: 'Bad Request',
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response(
          JSON.stringify({ ok: true, message: result.message ?? 'Saved.' }),
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      // Other methods (PUT / DELETE) — fall through to the real fetch so the
      // webview surfaces a real network error rather than a 502 from us.
      return realFetch(input as RequestInfo, init)
    }

    // Special-case `/api/hermes-config`: the settings dialog uses this
    // endpoint (not `/api/claude-config`) to read and write the agent's
    // configuration. Hermes Agent's gateway (:8642) does not expose it, so
    // we route it to the same Rust-side `claude_config_get` / `claude_config_patch`
    // commands that read `%LOCALAPPDATA%\hermes\config.yaml` + `.env` directly.
    if (matched.path === '/api/hermes-config') {
      const upperMethod = (method || 'GET').toUpperCase()
      if (upperMethod === 'GET') {
        const result = (await hermesDesktop.gateway.claudeConfigGet()) as
          | { ok: boolean; data?: unknown; error?: string }
          | null
        if (!result) return realFetch(input as RequestInfo, init)
        if (!result.ok) {
          return new Response(
            JSON.stringify({
              error: result.error ?? 'Hermes config unavailable',
              ok: false,
            }),
            {
              status: 502,
              statusText: 'Bad Gateway',
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response(JSON.stringify(result.data ?? {}), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        })
      }

      if (upperMethod === 'PATCH' || upperMethod === 'POST') {
        let parsed: unknown = body
        if (typeof body === 'string' && body.length > 0) {
          try {
            parsed = JSON.parse(body)
          } catch {
            // Leave as the raw string; the Rust side will surface a 400.
          }
        }
        const result = (await hermesDesktop.gateway.claudeConfigPatch(parsed)) as
          | { ok: boolean; message?: string; error?: string }
          | null
        if (!result) return realFetch(input as RequestInfo, init)
        if (!result.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: result.error ?? 'Patch failed',
            }),
            {
              status: 400,
              statusText: 'Bad Request',
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response(
          JSON.stringify({ ok: true, message: result.message ?? 'Saved.' }),
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      return realFetch(input as RequestInfo, init)
    }

    // Special-case `/api/local-providers`: the settings dialog calls this to
    // discover local providers (ollama, atomic-chat). In the Tauri desktop
    // the TanStack Start server route is not available, so return an empty
    // result. The UI will fall back to the hardcoded provider cards.
    if (matched.path === '/api/local-providers') {
      return new Response(
        JSON.stringify({ ok: true, providers: [], models: [], totalLocalModels: 0 }),
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const headersObj: Record<string, string> = {}
    if (init?.headers) {
      const h = new Headers(init.headers)
      h.forEach((v, k) => {
        headersObj[k] = v
      })
    }

    const payload: Record<string, unknown> = { method, headers: headersObj }
    if (body !== undefined) payload.body = body

    const result = (await hermesDesktop.gateway.request(
      matched.path,
      payload,
      gatewayUrl,
    )) as { ok: boolean; data?: unknown; error?: string } | null

    if (!result) {
      return realFetch(input as RequestInfo, init)
    }
    if (!result.ok) {
      // Gateway sidecar not running (or returned a transport error). Surface
      // a clean JSON error so the store's `.json()` doesn't blow up on the
      // placeholder HTML the webview would otherwise return.
      return new Response(
        JSON.stringify({ error: result.error ?? 'Gateway unreachable' }),
        {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    // The gateway occasionally returns 404 / 401 / non-JSON bodies (e.g. when
    // `/api/gateway-status` isn't implemented in the running Hermes Agent
    // build). In that case `result.data` is `null` and any renderer code that
    // reads `data.capabilities` synchronously will throw
    // "Cannot read properties of null (reading 'capabilities')". Normalize to
    // an empty object so the store can render a graceful "no compatible
    // backend" state instead of crashing the route.
    const safeData =
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data
        : {}
    return new Response(JSON.stringify(safeData), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
  }
  // Preserve call-site `this` so streaming bodies etc. still work.
  window.fetch = override as typeof window.fetch
}

if (typeof window !== 'undefined') {
  window.hermesDesktop = hermesDesktop
  window.__HERMES_TAURI__ = inTauri()
  installFetchInterceptor(DEFAULT_GATEWAY_URL)
}

export type { DesktopStatus, UpdateState }
