/**
 * Diagnostic endpoint that surfaces the active CopilotKit runtime config
 * (without leaking the API key) so the UI can show whether the LLM
 * provider is wired up correctly.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getCopilotKitStatus } from '@/server/copilotkit-runtime'

export const Route = createFileRoute('/api/copilotkit-status')({
  server: {
    handlers: {
      GET: async () => Response.json(getCopilotKitStatus()),
    },
  },
})
