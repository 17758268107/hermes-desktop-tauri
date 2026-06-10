/**
 * CopilotPanel — collapsible right-panel AI assistant overlay.
 *
 * Mirrors the visual chrome of `ChatPanel` (a 420 px right-anchored
 * slide-in with header + close button) but renders CopilotKit's
 * `<CopilotChat>` as the body. The CopilotKit provider must wrap the
 * app higher up in the tree — see `copilot-provider.tsx`.
 *
 * The panel is wired to `useWorkspaceStore.copilotPanelOpen` so it
 * composes cleanly with the existing chat panel, file explorer, and
 * focus mode toggles.
 *
 * Note: the API key for the underlying LLM lives in `process.env`
 * on the server (see `src/server/copilotkit-runtime.ts`). The browser
 * only ever talks to `/api/copilotkit`, so the key never leaks.
 */
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { CopilotChat } from '@copilotkit/react-core/v2'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type CopilotStatus = {
  ok: boolean
  baseURL: string
  modelId: string
  apiKeyConfigured: boolean
  systemPrompt: string
  endpoint: string
}

export function CopilotPanel() {
  const isOpen = useWorkspaceStore((s) => s.copilotPanelOpen)
  const setCopilotPanelOpen = useWorkspaceStore((s) => s.setCopilotPanelOpen)

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
            {/* Panel header */}
            <div
              className="flex items-center justify-between h-10 px-3 border-b shrink-0"
              style={{ borderColor: 'var(--theme-border)' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <HugeiconsIcon
                  icon={SparklesIcon}
                  size={14}
                  strokeWidth={1.5}
                  className="text-accent-500"
                />
                <span className="text-xs font-medium text-primary-700 truncate max-w-[260px]">
                  Hermes Copilot
                  {statusQuery.data?.modelId ? (
                    <span className="ml-1.5 opacity-60">· {statusQuery.data.modelId}</span>
                  ) : null}
                </span>
              </div>
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

            {/* Panel body — CopilotChat. The component owns its own scroll,
                composer, and message rendering. We just constrain height. */}
            <div
              className="flex-1 min-h-0"
              data-testid="copilot-panel-body"
            >
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
                <CopilotChat
                  labels={{
                    modalHeaderTitle: 'Hermes Copilot',
                    welcomeMessageText:
                      'Hi! Ask me about ports, services, or Hermes commands.',
                  }}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
