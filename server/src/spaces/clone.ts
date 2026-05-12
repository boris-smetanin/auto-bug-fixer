import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type CloneOptions = {
  owner: string;
  repo: string;
  token: string;
  destDir: string;
  signal?: AbortSignal;
};

export class CloneError extends Error {
  public readonly exitCode: number | null;
  public readonly aborted: boolean;

  constructor(message: string, exitCode: number | null, aborted = false) {
    super(message);
    this.name = 'CloneError';
    this.exitCode = exitCode;
    this.aborted = aborted;
  }
}

export async function cloneRepoWithToken(opts: CloneOptions): Promise<void> {
  await mkdir(path.dirname(opts.destDir), { recursive: true });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'abf-askpass-'));
  const askpassPath = path.join(tmpDir, 'askpass.sh');
  const askpassScript =
    '#!/bin/sh\n' +
    'case "$1" in\n' +
    '  *Username*) echo "x-oauth-basic" ;;\n' +
    '  *)        echo "$GIT_TOKEN" ;;\n' +
    'esac\n';
  await writeFile(askpassPath, askpassScript, { mode: 0o700 });

  try {
    await runGitClone({
      url: `https://github.com/${opts.owner}/${opts.repo}.git`,
      destDir: opts.destDir,
      askpassPath,
      token: opts.token,
      signal: opts.signal,
    });
  } catch (err) {
    await rm(opts.destDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type RunArgs = {
  url: string;
  destDir: string;
  askpassPath: string;
  token: string;
  signal?: AbortSignal;
};

function runGitClone(args: RunArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--', args.url, args.destDir], {
      env: {
        ...process.env,
        GIT_ASKPASS: args.askpassPath,
        GIT_TERMINAL_PROMPT: '0',
        GIT_TOKEN: args.token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1000).unref();
    };

    if (args.signal) {
      if (args.signal.aborted) {
        onAbort();
      } else {
        args.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('error', (err) => {
      args.signal?.removeEventListener('abort', onAbort);
      reject(new CloneError(err.message, null, aborted));
    });

    child.on('exit', (code, signal) => {
      args.signal?.removeEventListener('abort', onAbort);
      if (code === 0 && !aborted) {
        resolve();
        return;
      }
      if (aborted || signal) {
        reject(new CloneError(`git clone aborted (signal ${signal ?? 'SIGTERM'})`, code, true));
        return;
      }
      reject(new CloneError(`git clone exited ${code}: ${stderr.trim()}`, code, false));
    });
  });
}
