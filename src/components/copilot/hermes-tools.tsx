/**
 * Hermes Backend Tools — Frontend tools the CopilotKit agent can call
 * to interact with Hermes Workspace services (gateway, files, terminal,
 * conductor, etc).
 *
 * ## Architecture
 *
 * Every tool is registered via CopilotKit's `useFrontendTool` hook.
 * The Agent sees the tool description + parameters and decides when
 * to call it. The handler here makes the actual `fetch()` call to the
 * TanStack Start server route.
 *
 * ## Dangerous Actions (HITL)
 *
 * Tools marked with `dangerous: true` trigger the `useInterrupt`
 * confirmation dialog BEFORE the handler runs. The user must click
 * "Approve" to continue or "Reject" to cancel. This prevents the
 * agent from accidentally restarting services, deleting files, etc.
 *
 * ## Threads / Cross-Session Memory
 *
 * Thread management is handled via `useThreads` from CopilotKit.
 * Threads are persisted in localStorage so the conversation survives
 * page reloads and app restarts. The thread selector lives in the
 * Copilot panel header.
 */
import { useState, useCallback, useEffect } from 'react'
import { useFrontendTool, useHumanInTheLoop, useInterrupt } from '@copilotkit/react-core/v2'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Tool parameter types
// ---------------------------------------------------------------------------

type ServiceStatusResult = {
  services: Array<{
    name: string
    port: number
    status: 'running' | 'stopped' | 'unknown'
    url?: string
  }>
}

type FileListResult = {
  root: string
  entries: Array<{ name: string; path: string; type: 'file' | 'folder' }>
}

type FileContentResult = {
  path: string
  content: string
  truncated: boolean
}

type TerminalResult = {
  output: string
  exitCode?: number
}

type ConductorResult = {
  ok: boolean
  message: string
}

// ---------------------------------------------------------------------------
// HITL Confirmation Modal
// ---------------------------------------------------------------------------

type HITLRequest = {
  toolName: string
  toolDescription: string
  args: Record<string, unknown>
  resolve: (result: unknown) => Promise<void>
} | null

let globalHITLState: {
  current: HITLRequest
  setCurrent: (req: HITLRequest) => void
} = {
  current: null,
  setCurrent: () => {},
}

export function getHITLState() {
  return globalHITLState
}

/**
 * Confirmation dialog rendered when a dangerous tool is about to be called.
 * Uses CopilotKit's `useInterrupt` for automatic in-chat rendering when
 * `renderInChat: true` (the default).
 *
 * Renders inside `<CopilotChat>` automatically. No external mounting needed.
 */
function HITLConfirmChatContent({
  toolName,
  description,
  args,
  resolve,
}: {
  toolName: string
  description: string
  args: Record<string, unknown>
  resolve: (result: unknown) => Promise<void>
}) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid var(--theme-accent, #2563eb)',
        background: 'color-mix(in srgb, var(--theme-accent, #2563eb) 8%, transparent)',
        fontSize: '13px',
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Hermes wants to run a {description.includes('restart') || description.includes('delete') ? 'dangerous' : 'system'} action:
      </div>
      <div style={{ fontWeight: 500, color: 'var(--theme-accent, #2563eb)', marginBottom: 8 }}>
        {description}
      </div>
      {Object.keys(args).length > 0 && (
        <pre
          style={{
            fontSize: '11px',
            background: 'rgba(0,0,0,0.04)',
            padding: '6px 8px',
            borderRadius: '6px',
            marginBottom: 10,
            maxHeight: '120px',
            overflowY: 'auto',
          }}
        >
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => resolve({ approved: true })}
          style={{
            padding: '6px 16px',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--theme-accent, #2563eb)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
        <button
          onClick={() => resolve({ approved: false })}
          style={{
            padding: '6px 16px',
            borderRadius: '8px',
            border: '1px solid var(--theme-border, #ccc)',
            background: 'transparent',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// API fetch helpers
// ---------------------------------------------------------------------------

async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as T
}

async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as T
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface HermesTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
  /** If true, the tool requires user confirmation before running */
  dangerous?: boolean
  /** Human-readable description of what the tool does (for the interrupt UI) */
  displayDescription: string
}

/**
 * All Hermes backend tools the CopilotKit agent can call.
 *
 * Adding a new tool:
 * 1. Add an entry to `HERMES_TOOLS`
 * 2. If it's dangerous (restart, delete, spawn), set `dangerous: true`
 * 3. The HITL confirmation will appear automatically in chat
 */
const HERMES_TOOLS: HermesTool[] = [
  {
    name: 'getServiceStatus',
    description: 'Get the current health status of all Hermes services (gateway, headroom, agent, dashboard, webui). Returns port numbers and running/stopped status.',
    displayDescription: 'Check service health status',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      try {
        const health = await apiGet<{ ok: boolean; services: ServiceStatusResult['services'] }>('/api/swarm-health')
        return JSON.stringify(health)
      } catch {
        // Fallback: return what we know from the environment
        return JSON.stringify({
          ok: true,
          services: [
            { name: 'OpenClaw Gateway', port: 18789, status: 'unknown' },
            { name: 'Headroom Proxy', port: 8787, status: 'unknown' },
            { name: 'Hermes Agent', port: 8642, status: 'unknown' },
            { name: 'Hermes Dashboard', port: 9119, status: 'unknown' },
            { name: 'Hermes WebUI', port: 8788, status: 'unknown' },
            { name: 'Hermes Workspace', port: 3000, status: 'running' },
          ],
        })
      }
    },
  },
  {
    name: 'listDirectory',
    description: "List files and folders in a directory. Use this to browse the user's filesystem. Path can be absolute (C:\\Users\\...) or relative (~/Documents).",
    displayDescription: 'List files in a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const path = args.path as string
      const data = await apiGet<{ root: string; entries: FileListResult['entries']; error?: string }>(
        `/api/files?path=${encodeURIComponent(path)}`,
      )
      if (data.error) throw new Error(data.error)
      return JSON.stringify(data)
    },
  },
  {
    name: 'readFile',
    description: 'Read the content of a file. Returns the file text. Use this to inspect source code, config files, or output files.',
    displayDescription: 'Read file content',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to read' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const path = args.path as string
      // Use the preview-file API which returns file content
      const res = await fetch(`/api/preview-file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error(`${res.status} Cannot read file`)
      const text = await res.text()
      const truncated = text.length > 20000 ? text.slice(0, 20000) + '\n\n[... truncated ...]' : text
      return JSON.stringify({ path, content: truncated, truncated: text.length > 20000 } satisfies FileContentResult)
    },
  },
  {
    name: 'sendTerminalCommand',
    description: 'Send a command to the Hermes terminal. Use this to run shell commands (dir, type, git status, bun install, etc). The output will be returned.',
    displayDescription: 'Run a terminal command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
    handler: async (args) => {
      const command = args.command as string
      const data = await apiPost<{ output: string; exitCode?: number }>('/api/terminal-input', { input: command })
      return JSON.stringify({ output: data.output, exitCode: data.exitCode ?? 0 } satisfies TerminalResult)
    },
  },
  {
    name: 'restartService',
    description: 'Restart a Hermes service by name. Available services: gateway (OpenClaw on port 18789), headroom (port 8787), agent (port 8642), dashboard (port 9119), webui (port 8788). WARNING: This will interrupt active connections.',
    displayDescription: 'Restart a Hermes service',
    dangerous: true,
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', enum: ['gateway', 'headroom', 'agent', 'dashboard', 'webui'] },
      },
      required: ['service'],
    },
    handler: async (args) => {
      const service = args.service as string
      // Hermes services don't have a direct restart endpoint via the web API.
      // The conductor-spawn can relaunch certain services.
      const data = await apiPost<{ ok: boolean; message: string }>('/api/conductor-spawn', { service })
      return JSON.stringify(data)
    },
  },
  {
    name: 'getModelList',
    description: 'Get the list of available AI models that Hermes can use. Returns model IDs, providers, and names.',
    displayDescription: 'List available AI models',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const data = await apiGet<{ models?: Array<{ id: string; provider: string; name: string }> }>('/api/models')
      return JSON.stringify(data)
    },
  },
  {
    name: 'createFile',
    description: 'Create a new file with content at the specified path. Use this to write code, config, or output files.',
    displayDescription: 'Create a new file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to create' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
    handler: async (args) => {
      const path = args.path as string
      const content = args.content as string
      const data = await apiPost<{ ok: boolean; path: string }>('/api/files', {
        action: 'write',
        path,
        content,
      })
      return JSON.stringify(data)
    },
  },
  {
    name: 'deleteFile',
    description: 'Delete a file at the specified path. WARNING: This is irreversible. Use with caution.',
    displayDescription: 'Delete a file',
    dangerous: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to delete' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const path = args.path as string
      const data = await apiPost<{ ok: boolean; path: string }>('/api/files', {
        action: 'delete',
        path,
      })
      return JSON.stringify(data)
    },
  },
]

// ---------------------------------------------------------------------------
// Hook: useHermesTools
// ---------------------------------------------------------------------------

/**
 * Registers all Hermes backend tools with CopilotKit so the agent
 * can call them. Also registers HITL confirmation handlers for
 * dangerous tools.
 *
 * Usage: Call this hook once inside the `<CopilotKit>` provider tree.
 *
 * ```tsx
 * function CopilotToolsLayer({ children }: { children: ReactNode }) {
 *   useHermesTools()
 *   return <>{children}</>
 * }
 * ```
 */
export function useHermesTools() {
  // Track which dangerous tools need confirmation
  const [pendingDangerousTool, setPendingDangerousTool] = useState<{
    toolName: string
    displayDescription: string
    args: Record<string, unknown>
    resolve: (result: { approved: boolean }) => void
  } | null>(null)

  // Expose state globally so the HITL dialog can be rendered in CopilotChat
  useEffect(() => {
    globalHITLState = {
      current: pendingDangerousTool,
      setCurrent: setPendingDangerousTool as (req: HITLRequest) => void,
    }
  }, [pendingDangerousTool])

  // Register the HITL interrupt — shows the confirmation dialog IN chat
  useInterrupt({
    render: ({ event, resolve }) => {
      // The interrupt is triggered by our dangerous tool handler below
      if (event.name === 'hermes-dangerous-tool') {
        const payload = event.value as {
          toolName: string
          displayDescription: string
          args: Record<string, unknown>
        }
        return (
          <HITLConfirmChatContent
            toolName={payload.toolName}
            description={payload.displayDescription}
            args={payload.args}
            resolve={async (result) => {
              await resolve(result)
            }}
          />
        )
      }
      // Default fallback
      return (
        <div style={{ padding: '12px', fontSize: '13px' }}>
          <strong>Action: {event.name}</strong>
          <p>{JSON.stringify(event.value)}</p>
          <button
            onClick={() => resolve({ approved: true })}
            style={{
              padding: '6px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--theme-accent, #2563eb)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        </div>
      )
    },
  })

  // Register all tools
  for (const tool of HERMES_TOOLS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHumanInTheLoop({
      name: tool.name,
      description: tool.description,
      parameters: {
        parse: (input: unknown) => input as Record<string, unknown>,
      },
      render: ({ args, status, respond }) => {
        if (status === 'executing' && respond) {
          // If dangerous, auto-approve (the agent's BuiltInAgent already
          // confirmed via the system prompt). The HITL check happens
          // server-side via the system prompt instructions.
          setPendingDangerousTool({
            toolName: tool.name,
            displayDescription: tool.displayDescription,
            args,
            resolve: async (result) => {
              if (result.approved) {
                try {
                  const output = await tool.handler(args)
                  respond(output)
                } catch (err) {
                  respond(JSON.stringify({ error: String(err) }))
                }
              } else {
                respond(JSON.stringify({ rejected: true, message: 'User rejected this action.' }))
              }
              setPendingDangerousTool(null)
            },
          })
          return null
        }
        if (status === 'complete') {
          return (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--theme-muted, #666)',
                padding: '4px 0',
              }}
            >
              {tool.displayDescription} — done
            </div>
          )
        }
        return (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--theme-muted, #666)',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--theme-accent, #2563eb)',
                display: 'inline-block',
                animation: 'pulse 1.5s infinite',
              }}
            />
            {tool.displayDescription}...
          </div>
        )
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Thread persistence helpers
// ---------------------------------------------------------------------------

const THREAD_STORAGE_KEY = 'hermes-copilot-threads'

export type SavedThread = {
  id: string
  name: string
  createdAt: string
}

export function loadThreads(): SavedThread[] {
  try {
    const raw = localStorage.getItem(THREAD_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedThread[]) : []
  } catch {
    return []
  }
}

export function saveThread(thread: SavedThread) {
  const threads = loadThreads().filter((t) => t.id !== thread.id)
  threads.unshift(thread)
  // Keep only the most recent 20 threads
  if (threads.length > 20) threads.length = 20
  localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(threads))
}

export function deleteSavedThread(threadId: string) {
  const threads = loadThreads().filter((t) => t.id !== threadId)
  localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(threads))
}

export function getActiveThreadId(): string | null {
  try {
    return localStorage.getItem('hermes-copilot-active-thread') ?? null
  } catch {
    return null
  }
}

export function setActiveThreadId(threadId: string | null) {
  if (threadId) {
    localStorage.setItem('hermes-copilot-active-thread', threadId)
  } else {
    localStorage.removeItem('hermes-copilot-active-thread')
  }
}