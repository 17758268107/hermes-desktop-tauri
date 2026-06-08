/**
 * Reactive capability hook — reads from the /api/gateway-status query.
 * Use this instead of the synchronous isFeatureAvailable() in React components.
 * Returns null while loading (use to show a spinner), false if unavailable,
 * true if available.
 */
import { useQuery } from '@tanstack/react-query'

interface GatewayStatus {
  capabilities: Record<string, boolean>
  claudeUrl: string
}

function useGatewayStatus() {
  return useQuery<GatewayStatus>({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await fetch('/api/gateway-status')
      if (!res.ok) throw new Error('gateway-status fetch failed')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useIsFeatureAvailable(feature: string): boolean | null {
  const { data, isLoading } = useGatewayStatus()
  if (isLoading || !data) return null
  // Defensive: the gateway may return `{}` or `{capabilities: null}` when the
  // endpoint isn't implemented in the running Hermes Agent build (e.g. on a
  // 404). Without this guard, `data.capabilities[feature]` throws
  // "Cannot read properties of null (reading 'capabilities')" and the whole
  // route unmounts.
  const capabilities = (data as { capabilities?: Record<string, boolean> | null })
    .capabilities
  if (!capabilities || typeof capabilities !== 'object') return false
  return capabilities[feature] === true
}
