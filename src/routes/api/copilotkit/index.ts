/**
 * AG-UI / CopilotKit runtime endpoint — base path (`/api/copilotkit`).
 *
 * Delegates to the framework-agnostic `createCopilotRuntimeHandler` from
 * `@copilotkit/runtime/v2`. All subpaths (`/info`, `/agent/default/run`,
 * `/threads`, etc.) are handled by the sibling `$.ts` catch-all route.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getCopilotKitFetchHandler } from '@/server/copilotkit-runtime'

const dispatch = getCopilotKitFetchHandler()

export const Route = createFileRoute('/api/copilotkit/')({
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