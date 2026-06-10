/**
 * Floating button to toggle the AI Copilot panel on non-chat routes.
 * Sits in the bottom-right next to the chat toggle button, with a
 * sparkle icon to distinguish it from the human chat.
 */
import { HugeiconsIcon } from '@hugeicons/react'
import { SparklesIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Button } from '@/components/ui/button'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function CopilotPanelToggle() {
  const isOpen = useWorkspaceStore((s) => s.copilotPanelOpen)
  const toggleCopilotPanel = useWorkspaceStore((s) => s.toggleCopilotPanel)

  return (
    <AnimatePresence>
      {!isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
          className="fixed bottom-12 right-20 z-50"
        >
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                onClick={toggleCopilotPanel}
                render={
                  <Button
                    size="icon"
                    className="size-12 rounded-full bg-primary-800 text-cream-50 shadow-lg hover:bg-primary-900 active:scale-95 transition-all"
                    aria-label="Open Hermes Copilot"
                  >
                    <HugeiconsIcon
                      icon={SparklesIcon}
                      size={22}
                      strokeWidth={1.5}
                    />
                  </Button>
                }
              />
              <TooltipContent side="left">
                <span>
                  Copilot <kbd className="ml-1 text-[10px] opacity-60">⌘.</kbd>
                </span>
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
