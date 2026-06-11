/**
 * CopilotKit provider wrapper.
 *
 * Hermes Workspace integrates CopilotKit (AG-UI protocol) as a thin
 * overlay agent. The runtime endpoint lives at `/api/copilotkit` (see
 * `src/routes/api/copilotkit.ts`); the runtime config is created from
 * the standard Vercel AI SDK OpenAI provider, so any OpenAI-compatible
 * base URL (tokendance.space, headroom proxy, OpenAI official) works
 * with no code changes.
 *
 * Mount this once near the React root. The `<CopilotPanel>` component
 * (rendered inside `WorkspaceShell`) reads from the same context.
 *
 * The CopilotKit stylesheet is loaded via `<link rel="stylesheet">`
 * from `src/routes/__root.tsx` (same `?url` pattern used for the
 * main `appCss`) — direct `import '*.css'` would break TanStack
 * Start's prerender pass, which runs in Node and cannot load CSS.
 */
import type { ReactNode } from 'react'
import { CopilotKit } from '@copilotkit/react-core/v2'

const RUNTIME_URL = '/api/copilotkit'

export function CopilotProvider({ children }: { children: ReactNode }) {
  return (
    <CopilotKit runtimeUrl={RUNTIME_URL} credentials="include">
      {children}
    </CopilotKit>
  )
}
