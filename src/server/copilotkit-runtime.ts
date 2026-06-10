/**
 * CopilotKit runtime configuration.
 *
 * Owns the singleton `CopilotRuntime` + `BuiltInAgent` used by the
 * `/api/copilotkit` TanStack Start server route. The runtime streams
 * AG-UI events from a Vercel AI SDK `LanguageModel` — the same `ai`
 * package family CopilotKit's built-in agent uses internally.
 *
 * Provider is OpenAI-compatible by default, so the same code path
 * works for:
 *   • tokendance.space  (set OPENAI_BASE_URL=https://tokendance.space/v1)
 *   • headroom proxy    (set OPENAI_BASE_URL=http://127.0.0.1:8787/v1)
 *   • OpenAI official   (leave OPENAI_BASE_URL unset)
 *
 * Environment variables (all optional except OPENAI_API_KEY):
 *   OPENAI_API_KEY      Required. API key sent as `Authorization: Bearer …`.
 *   OPENAI_BASE_URL     Optional. Defaults to https://api.openai.com/v1.
 *   COPILOTKIT_MODEL    Optional. Defaults to "openai/gpt-4o-mini".
 *   COPILOTKIT_SYSTEM   Optional. System prompt prepended to every turn.
 *
 * Keys are read from `process.env` once at first import; restart the
 * server after changing them.
 */
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from '@copilotkit/runtime/v2'
import { createOpenAI } from '@ai-sdk/openai'

type RuntimeConfig = {
  apiKey: string
  baseURL: string
  modelId: string
  systemPrompt: string
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL_ID = 'gpt-4o-mini'
const DEFAULT_SYSTEM_PROMPT = [
  'You are Hermes Copilot, an AI assistant embedded in the Hermes Workspace',
  'desktop app. You can see the user\u2019s port status, the OpenClaw gateway,',
  'Headroom proxy, and the Hermes Agent runtime through frontend tools.',
  'Prefer concise answers in the user\u2019s language. Confirm before running any',
  'destructive action (restarting services, deleting files, rotating keys).',
].join(' ')

function readEnvConfig(): RuntimeConfig {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  const baseURL = (
    process.env.OPENAI_BASE_URL ??
    process.env.COPILOTKIT_OPENAI_BASE_URL ??
    DEFAULT_BASE_URL
  ).trim()
  const modelId = (process.env.COPILOTKIT_MODEL ?? DEFAULT_MODEL_ID).trim()
  const systemPrompt = (
    process.env.COPILOTKIT_SYSTEM ?? DEFAULT_SYSTEM_PROMPT
  ).trim()
  return { apiKey, baseURL, modelId, systemPrompt }
}

function buildAgent(config: RuntimeConfig) {
  // `createOpenAI` from @ai-sdk/openai yields a callable factory. Passing
  // `baseURL` here lets the same code work with tokendance.space,
  // headroom proxy, or any other OpenAI-compatible endpoint.
  const provider = createOpenAI({
    apiKey: config.apiKey || 'no-key-configured',
    baseURL: config.baseURL,
  })
  const model = provider(config.modelId)
  return new BuiltInAgent({
    model,
    // BuiltInAgent forwards `prompt` to the Vercel AI SDK streamText call as
    // the system prompt prepended to every turn.
    ...(config.systemPrompt ? { prompt: config.systemPrompt } : {}),
  })
}

let cachedHandler: ((request: Request) => Promise<Response>) | null = null
let cachedConfigKey: string | null = null

function buildHandler() {
  const config = readEnvConfig()
  const agent = buildAgent(config)
  const runtime = new CopilotRuntime({
    agents: { default: agent },
  })
  return createCopilotRuntimeHandler({
    runtime,
    basePath: '/api/copilotkit',
    // The frontend lives on the same origin as the API route, so the
    // default same-origin policy is fine. Enable CORS if you ever
    // expose the runtime on a separate host.
    cors: false,
  })
}

/**
 * Framework-agnostic fetch handler for `/api/copilotkit`. Memoized so we
 * only rebuild the runtime on cold start (and when the relevant env vars
 * change between requests, e.g. during dev hot-reload).
 */
export function getCopilotKitFetchHandler(): (request: Request) => Promise<Response> {
  const config = readEnvConfig()
  const configKey = `${config.apiKey}|${config.baseURL}|${config.modelId}|${config.systemPrompt}`
  if (!cachedHandler || cachedConfigKey !== configKey) {
    cachedHandler = buildHandler()
    cachedConfigKey = configKey
  }
  return cachedHandler
}

/**
 * Diagnostic helper used by `/api/copilotkit-status` to surface the
 * current runtime config to the UI without exposing the API key.
 */
export function getCopilotKitStatus() {
  const config = readEnvConfig()
  return {
    ok: true,
    baseURL: config.baseURL,
    modelId: config.modelId,
    apiKeyConfigured: Boolean(config.apiKey),
    systemPrompt: config.systemPrompt.slice(0, 200),
    endpoint: '/api/copilotkit',
  }
}
