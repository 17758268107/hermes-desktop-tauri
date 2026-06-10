/**
 * AG-UI / CopilotKit runtime endpoint — all subpaths
 * (`/api/copilotkit/*`).
 *
 * CopilotKit's internal router dispatches based on the full request URL
 * (`/info`, `/agent/:agentId/run`, `/threads/:threadId`, etc.), so we
 * forward every method and path through the same handler. The base path
 * (`/api/copilotkit`) is handled by the sibling `index.ts` route.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getCopilotKitFetchHandler } from '@/server/copilotkit-runtime'

const dispatch = getCopilotKitFetchHandler()

export const Route = createFileRoute('/api/copilotkit/$')({
  server: {
    handlers: {
      GET: async ({ request }) => dispatch(request),
      POST: async ({ request }) => dispatch(request),
      DELETE: async ({ request }) => dispatch(request),
      PATCH: async ({ request }) => dispatch(request),
      PUT: async ({ request }) => dispatch(request),
    },
  },
})