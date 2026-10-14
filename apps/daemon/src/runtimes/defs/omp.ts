import path from 'node:path';
import { DEFAULT_MODEL_OPTION, execAgentFile } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

// Sessions live in a fixed OD-owned directory under the daemon data root so
// capture-style resume finds them on follow-up turns regardless of the
// project cwd omp would otherwise bucket sessions under. buildArgs runs in
// the daemon process, whose OD_DATA_DIR is the resolved data root (set by the
// sidecar lifecycle before the daemon boots); agent children inherit it too.
// Keep the flag derivation in one place so the resume path and the create
// path agree.
export function ompSessionArgs(runtimeContext: {
  cwd?: string;
  resumeSessionId?: string | null;
}): string[] {
  const sessionDir = path.join(
    process.env.OD_DATA_DIR || process.cwd(),
    'omp-sessions',
  );
  const args = ['--session-dir', sessionDir];
  const resumeSessionId =
    typeof runtimeContext.resumeSessionId === 'string' &&
    runtimeContext.resumeSessionId.length > 0
      ? runtimeContext.resumeSessionId
      : null;
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  return args;
}

export const ompAgentDef = {
    id: 'omp',
    name: 'OMP (oh-my-pi)',
    bin: 'omp',
    versionArgs: ['--version'],
    versionProbeTimeoutMs: 15_000,
    // `omp models --json` prints the full catalog as one JSON object
    // ({models:[{selector,name,thinking,...}]}). Selectors are
    // `provider/model` — the same shape `--model` accepts at run time.
    fetchModels: async (resolvedBin, env) => {
      try {
        const { stdout } = await execAgentFile(resolvedBin, ['models', '--json'], {
          env,
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
        });
        const parsed = JSON.parse(String(stdout)) as {
          models?: Array<{
            selector?: string;
            name?: string;
            id?: string;
            provider?: string;
            thinking?: string[] | null;
          }>;
        };
        const models = Array.isArray(parsed.models) ? parsed.models : [];
        const options = models
          .filter((m) => typeof m.selector === 'string' && m.selector.length > 0)
          .map((m) => {
            const id = m.selector as string;
            const label =
              typeof m.name === 'string' && m.name.length > 0 ? `${m.name} (${id})` : id;
            const thinking = Array.isArray(m.thinking) ? m.thinking : [];
            return {
              id,
              label,
              ...(thinking.length > 0
                ? {
                    reasoningOptions: [
                      { id: 'default', label: 'Default' },
                      ...thinking.map((t) => ({ id: t, label: t })),
                    ],
                  }
                : {}),
            };
          });
        return options.length > 0 ? [DEFAULT_MODEL_OPTION, ...options] : null;
      } catch {
        return null;
      }
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (anthropic)' },
      { id: 'openai/gpt-5.2', label: 'GPT-5.2 (openai)' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (google)' },
    ],
    // `omp --mode json -p` streams the pi event vocabulary as NDJSON on
    // stdout while reading the prompt from stdin. Image attachments ride in
    // the prompt text as `@<path>` references (omp's MESSAGES `@` file syntax
    // reads them as image blocks; verified against omp 18.4.2). Sessions are
    // capture-style: omp mints its own id (reported on the stream's `session`
    // frame) and follow-up turns replay it via `--resume <id>`.
    buildArgs: (_prompt, _imagePaths, _extraAllowedDirs = [], options = {}, runtimeContext = {}) => {
      const args = ['--mode', 'json', '-p', ...ompSessionArgs(runtimeContext)];
      if (options.model && options.model !== 'default') {
        // omp --model accepts fuzzy patterns and `provider/model` selectors;
        // pass the chosen id through as-is.
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        args.push('--thinking', options.reasoning);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'omp',
    // omp reads the session id back from the stream's `session` frame (the
    // parser surfaces it as a `status` event's `sessionId`), so the daemon
    // captures it and persists it as the resume handle.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    // Images reach omp through `@<path>` references in the composed prompt
    // (see buildArgs note); the daemon already embeds them there for
    // stdin-prompt adapters, so no argv image plumbing is needed.
    supportsImagePaths: true,
} satisfies RuntimeAgentDef;
