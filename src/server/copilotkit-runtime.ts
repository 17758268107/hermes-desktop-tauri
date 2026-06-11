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
  'You are Hermes Copilot, an AI assistant embedded in the Hermes Workspace desktop app.',
  '',
  '## Available Tools',
  'You have these frontend tools available — call them when the user asks:',
  '- **getServiceStatus**: Check health of all Hermes services (gateway, headroom, agent, dashboard, webui).',
  '- **listDirectory(path)**: Browse filesystem directories.',
  '- **readFile(path)**: Read file contents.',
  '- **sendTerminalCommand(command)**: Execute shell commands.',
  '- **getModelList**: List available AI models.',
  '- **createFile(path, content)**: Create a new file.',
  '- **restartService(service)**: Restart a service (gateway|headroom|agent|dashboard|webui). DANGEROUS — requires user confirmation.',
  '- **deleteFile(path)**: Delete a file. DANGEROUS — requires user confirmation.',
  '',
  '## Safety Rules',
  '1. Before calling restartService or deleteFile, warn the user and wait for approval.',
  '2. Before running any `rm`, `del`, `format`, `shutdown`, or destructive command via sendTerminalCommand, ask the user to confirm.',
  '3. Prefer concise answers. Speak the user\'s language.',
  '4. If a tool call fails, explain the error and suggest alternatives.',
  '5. Never expose API keys, tokens, or secrets in responses.',
].join('\n')

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
  //
  // We use `.chat(modelId)` instead of `provider(modelId)` to force the
  // Chat Completions API (POST /v1/chat/completions). The default
  // `provider()` route uses the newer Responses API (POST /v1/responses)
  // which many OpenAI-compatible proxies do not support.
  const provider = createOpenAI({
    apiKey: config.apiKey || 'no-key-configured',
    baseURL: config.baseURL,
  })
  const model = provider.chat(config.modelId as any)
  return new BuiltInAgent({
    model,
    // BuiltInAgent forwards `prompt` to the Vercel AI SDK streamText call as
    // the system prompt prepended to every turn.
    ...(config.systemPrompt ? { prompt: config.systemPrompt } : {}),
  })
}

function buildHandler() {
  const config = readEnvConfig()
  const agent = buildAgent(config)
  const runtime = new CopilotRuntime({
    agents: { default: agent },
  })
  return createCopilotRuntimeHandler({
    runtime,
    basePath: '/api/copilotkit',
    mode: 'single-route',
    cors: false,
  })
}

/**
 * Framework-agnostic fetch handler for `/api/copilotkit`.
 * Always rebuilds to pick up the latest env vars.
 */
export function getCopilotKitFetchHandler(): (request: Request) => Promise<Response> {
  return buildHandler()
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
