/**
 * AG-UI / CopilotKit runtime endpoint.
 *
 * Mounted by TanStack Start at `POST /api/copilotkit`. The client-side
 * `<CopilotKit runtimeUrl="/api/copilotkit">` provider streams AG-UI
 * events through this route.
 *
 * Vite SSR consumes the request body stream before our handler runs,
 * so we read it once as text and reconstruct a fresh Request object.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getCopilotKitFetchHandler } from '@/server/copilotkit-runtime'

export const Route = createFileRoute('/api/copilotkit')({
  server: {
    handlers: {
      GET: async ({ request }) => getCopilotKitFetchHandler()(request),
      POST: async ({ request }) => {
        // Vite SSR may consume the request body stream before our handler runs.
        // Read the entire body once as text and reconstruct a fresh Request
        // object so CopilotKit's parseMethodCall can clone and parse it.
        const bodyText = await request.text()
        const headers = new Headers(request.headers)
        headers.set('content-type', 'application/json')
        const freshRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: bodyText,
        })
        return getCopilotKitFetchHandler()(freshRequest)
      },
    },
  },
})
