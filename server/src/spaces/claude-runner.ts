import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

export const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

export type RunLogger = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  data?: Record<string, unknown>,
) => void;

export type RunFixOptions = {
  cloneDir: string;
  baseBranch: string;
  fixBranchName: string;
  userPayload: string;
  signal?: AbortSignal;
  onLog: RunLogger;
};

export type RunFixResult = {
  success: true;
  totalCostUsd: number;
  numTurns: number;
  durationMs: number;
  resultText: string;
};

export class ClaudeRunError extends Error {
  public readonly reason: 'claude_error' | 'claude_timeout' | 'missing_api_key';
  public readonly detail?: Record<string, unknown>;
  constructor(
    reason: ClaudeRunError['reason'],
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ClaudeRunError';
    this.reason = reason;
    this.detail = detail;
  }
}

const SYSTEM_PROMPT_TEMPLATE = (baseBranch: string, fixBranch: string): string =>
  [
    'You are fixing a bug reported by Sentry in the repository at the working directory.',
    `Base branch: ${baseBranch}.`,
    `You are on branch: ${fixBranch}.`,
    '',
    'Read the stack trace and breadcrumbs in the user message.',
    'In case Additional Data is provided, use it to understand the context of the bug. It may contain relevant information such as recent code changes, logs, or user actions.', 
    'Locate the bug.',
    'Make the smallest fix that resolves it. Do not touch unrelated code.',
    'Do not run the test suite. Do not push. Do not open a PR — the orchestrator handles that.',
    'When the fix is ready, commit it via git from the Bash tool with a concise message.',
  ].join('\n');

export async function runClaudeFix(opts: RunFixOptions): Promise<RunFixResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'test') {
    throw new ClaudeRunError(
      'missing_api_key',
      'ANTHROPIC_API_KEY is missing or a placeholder',
    );
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, CLAUDE_TIMEOUT_MS);

  if (opts.signal) {
    if (opts.signal.aborted) {
      abortController.abort();
    } else {
      opts.signal.addEventListener('abort', () => abortController.abort(), {
        once: true,
      });
    }
  }

  const scopedEnv: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    ANTHROPIC_API_KEY: apiKey,
  };

  let lastResult: SDKResultMessage | undefined;

  try {
    const q = query({
      prompt: opts.userPayload,
      options: {
        cwd: opts.cloneDir,
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        env: scopedEnv,
        systemPrompt: SYSTEM_PROMPT_TEMPLATE(opts.baseBranch, opts.fixBranchName),
        abortController,
        settingSources: ['project'],
        persistSession: false,
        stderr: (line) => opts.onLog('warn', 'claude stderr', { line: line.trim() }),
      },
    });

    for await (const message of q) {
      switch (message.type) {
        case 'assistant': {
          for (const block of message.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              opts.onLog('info', 'claude assistant text', {
                text: block.text.slice(0, 500),
              });
            } else if (block.type === 'tool_use') {
              opts.onLog('info', `claude tool: ${block.name}`, {
                input: block.input,
              });
            }
          }
          break;
        }
        case 'result': {
          lastResult = message;
          opts.onLog('info', 'claude result', {
            is_error: message.is_error,
            duration_ms: message.duration_ms,
            num_turns: message.num_turns,
            total_cost_usd: message.total_cost_usd,
          });
          break;
        }
        case 'system':
          opts.onLog('info', 'claude system message');
          break;
        default:
          // Ignore other message types (partial, status, hook responses, etc.)
          break;
      }
    }

    clearTimeout(timeout);

    if (!lastResult) {
      throw new ClaudeRunError(
        'claude_error',
        'no result message received from agent',
      );
    }
    if (lastResult.is_error) {
      throw new ClaudeRunError('claude_error', `claude exited with error: ${lastResult.result}`, {
        result: lastResult.result,
      });
    }

    return {
      success: true,
      totalCostUsd: lastResult.total_cost_usd,
      numTurns: lastResult.num_turns,
      durationMs: lastResult.duration_ms,
      resultText: lastResult.result,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof ClaudeRunError) throw err;
    if (timedOut) {
      throw new ClaudeRunError(
        'claude_timeout',
        `15-minute timeout exceeded`,
      );
    }
    if (abortController.signal.aborted) {
      throw new ClaudeRunError('claude_error', 'aborted before completion');
    }
    throw new ClaudeRunError(
      'claude_error',
      err instanceof Error ? err.message : String(err),
    );
  }
}
