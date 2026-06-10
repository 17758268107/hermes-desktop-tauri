/**
 * CopilotPanel — collapsible right-panel AI assistant overlay.
 *
 * Mirrors the visual chrome of `ChatPanel` (a 420 px right-anchored
 * slide-in with header + close button) but renders CopilotKit's
 * `<CopilotChat>` as the body.
 *
 * ## Features
 *
 * - **Hermes Tools**: Agent can call `/api/swarm-health`, `/api/files`,
 *   `/api/terminal-input`, `/api/models`, etc. via `useFrontendTool`.
 * - **HITL Confirmation**: Dangerous actions (restart, delete) show a
 *   confirmation dialog in chat before executing.
 * - **Threads**: Saved in localStorage, selectable via header dropdown.
 *   Each thread has an independent conversation history.
 * - **LLM Status**: Shows the configured model and base URL in the header.
 */
import { useCallback, useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  SparklesIcon,
  Message01Icon,
  ArrowDown01Icon,
  PlusSignIcon,
  Delete01Icon,
} from '@hugeicons/core-free-icons'
import { CopilotChat, CopilotChatConfigurationProvider } from '@copilotkit/react-core/v2'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useHermesTools, loadThreads, saveThread, deleteSavedThread, getActiveThreadId, setActiveThreadId } from './hermes-tools'
import type { SavedThread } from './hermes-tools'

type CopilotStatus = {
  ok: boolean
  baseURL: string
  modelId: string
  apiKeyConfigured: boolean
  systemPrompt: string
  endpoint: string
}

// ---------------------------------------------------------------------------
// Thread Selector Dropdown
// ---------------------------------------------------------------------------

function ThreadSelector({
  activeThreadId,
  onSelect,
}: {
  activeThreadId: string | null
  onSelect: (threadId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [threads, setThreads] = useState<SavedThread[]>(() => loadThreads())

  const refreshThreads = useCallback(() => {
    setThreads(loadThreads())
  }, [])

  useEffect(() => {
    refreshThreads()
  }, [activeThreadId, refreshThreads])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleCreateThread = useCallback(() => {
    const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const newThread: SavedThread = {
      id,
      name: `Conversation ${threads.length + 1}`,
      createdAt: now,
    }
    saveThread(newThread)
    setActiveThreadId(id)
    onSelect(id)
    refreshThreads()
    setOpen(false)
  }, [threads.length, onSelect, refreshThreads])

  const activeThread = threads.find((t) => t.id === activeThreadId)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors hover:border-[var(--theme-accent)]"
        style={{
          borderColor: 'var(--theme-border)',
          color: 'var(--primary-600)',
          background: 'var(--theme-bg)',
        }}
      >
        <HugeiconsIcon icon={Message01Icon} size={12} strokeWidth={1.5} />
        <span className="max-w-[80px] truncate">
          {activeThread?.name ?? 'New Chat'}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={10}
          strokeWidth={1.5}
          className={open ? 'rotate-180' : ''}
          style={{ transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-[220px] rounded-xl border shadow-lg z-[100] py-1"
          style={{
            borderColor: 'var(--theme-border)',
            background: 'var(--theme-bg)',
          }}
        >
          <button
            type="button"
            onClick={handleCreateThread}
            className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--theme-card)]"
            style={{ color: 'var(--theme-accent)' }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.5} />
            New Conversation
          </button>

          {threads.length > 0 && (
            <div
              className="mx-2 my-1 border-t"
              style={{ borderColor: 'var(--theme-border)' }}
            />
          )}

          {threads.length === 0 && (
            <div
              className="px-3 py-3 text-[11px] text-center"
              style={{ color: 'var(--primary-500)' }}
            >
              No saved conversations
            </div>
          )}

          <div className="max-h-[200px] overflow-y-auto">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center gap-1 px-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(thread.id)
                    setOpen(false)
                  }}
                  className="flex-1 text-left px-2 py-1.5 text-[12px] rounded-lg transition-colors truncate hover:bg-[var(--theme-card)]"
                  style={{
                    color: thread.id === activeThreadId ? 'var(--theme-accent)' : 'var(--primary-700)',
                    fontWeight: thread.id === activeThreadId ? 600 : 400,
                  }}
                >
                  {thread.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (thread.id === activeThreadId) {
                      onSelect(null)
                    }
                    deleteSavedThread(thread.id)
                    refreshThreads()
                  }}
                  className="shrink-0 p-1 rounded-md transition-colors hover:bg-red-100"
                  style={{ color: 'var(--primary-400)' }}
                  aria-label={`Delete ${thread.name}`}
                >
                  <HugeiconsIcon icon={Delete01Icon} size={10} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CopilotToolsLayer — mounts tools and HITL inside the CopilotKit context
// ---------------------------------------------------------------------------

function CopilotToolsLayer({ children }: { children: React.ReactNode }) {
  useHermesTools()
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// CopilotPanel main component
// ---------------------------------------------------------------------------

export function CopilotPanel() {
  const isOpen = useWorkspaceStore((s) => s.copilotPanelOpen)
  const setCopilotPanelOpen = useWorkspaceStore((s) => s.setCopilotPanelOpen)

  // Thread management
  const [threadId, setThreadId] = useState<string | null>(() => getActiveThreadId())

  const handleThreadSelect = useCallback((newThreadId: string | null) => {
    setThreadId(newThreadId)
    setActiveThreadId(newThreadId)
  }, [])

  // LLM status
  const statusQuery = useQuery({
    queryKey: ['copilotkit-status'],
    queryFn: async (): Promise<CopilotStatus> => {
      const res = await fetch('/api/copilotkit-status')
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    },
    staleTime: 30_000,
  })

  const handleClose = () => setCopilotPanelOpen(false)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for narrow screens */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/20 z-10 min-[1200px]:hidden"
            onClick={handleClose}
            aria-hidden
          />
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed right-0 bottom-0 top-[var(--titlebar-h,0px)] h-[calc(100dvh-var(--titlebar-h,0px))] max-h-[calc(100dvh-var(--titlebar-h,0px))] w-[420px] max-w-[100vw] border-l overflow-hidden flex flex-col z-20 shadow-xl"
            style={{
              background: 'var(--theme-bg)',
              borderColor: 'var(--theme-border)',
            }}
          >
            {/* Panel header with Thread selector */}
            <div
              className="flex items-center justify-between h-10 px-3 border-b shrink-0 gap-2"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={SparklesIcon}
                  size={14}
                  strokeWidth={1.5}
                  className="text-accent-500"
                />
                <span className="text-xs font-medium text-primary-700 truncate max-w-[120px]">
                  Hermes Copilot
                  {statusQuery.data?.modelId ? (
                    <span className="ml-1 opacity-60">· {statusQuery.data.modelId}</span>
                  ) : null}
                </span>
              </div>

              <ThreadSelector
                activeThreadId={threadId}
                onSelect={handleThreadSelect}
              />

              <div className="flex items-center gap-0.5">
                <TooltipProvider>
                  <TooltipRoot>
                    <TooltipTrigger
                      onClick={handleClose}
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-primary-600 hover:text-primary-900"
                          aria-label="Close Copilot"
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={14}
                            strokeWidth={1.5}
                          />
                        </Button>
                      }
                    />
                    <TooltipContent side="bottom">Close</TooltipContent>
                  </TooltipRoot>
                </TooltipProvider>
              </div>
            </div>

            {/* Panel body */}
            <div className="flex-1 min-h-0" data-testid="copilot-panel-body">
              {statusQuery.data && !statusQuery.data.apiKeyConfigured ? (
                <div className="px-4 py-6 text-xs text-primary-600 space-y-2">
                  <p className="font-medium text-primary-800">
                    LLM provider not configured
                  </p>
                  <p>
                    Set <code>OPENAI_API_KEY</code> (and optionally{' '}
                    <code>OPENAI_BASE_URL</code>) in the Tauri{' '}
                    <code>.env</code>, then restart the app.
                  </p>
                  <p className="opacity-70">
                    Default endpoint:{' '}
                    <code>{statusQuery.data.baseURL}</code>
                  </p>
                </div>
              ) : (
                <CopilotChatConfigurationProvider
                  threadId={threadId ?? undefined}
                  labels={{
                    modalHeaderTitle: 'Hermes Copilot',
                    welcomeMessageText:
                      'Hi! Ask me about ports, services, files, or terminal commands. I can check service health, browse files, and run commands for you.',
                  }}
                >
                  <CopilotToolsLayer>
                    <CopilotChat
                      labels={{
                        modalHeaderTitle: 'Hermes Copilot',
                        welcomeMessageText:
                          'Hi! Ask me about ports, services, files, or terminal commands. I can check service health, browse files, and run commands for you.',
                      }}
                    />
                  </CopilotToolsLayer>
                </CopilotChatConfigurationProvider>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}