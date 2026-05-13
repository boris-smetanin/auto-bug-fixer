import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class GitError extends Error {
  public readonly exitCode: number | null;
  public readonly stderr: string;
  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

type RunOpts = {
  cwd: string;
  args: string[];
  token?: string;
  signal?: AbortSignal;
};

async function runGit(opts: RunOpts): Promise<{ stdout: string; stderr: string }> {
  let askpassDir: string | undefined;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_TERMINAL_PROMPT: '0',
    LANG: process.env.LANG,
  };

  if (opts.token) {
    askpassDir = await mkdtemp(path.join(os.tmpdir(), 'abf-askpass-'));
    const askpassPath = path.join(askpassDir, 'askpass.sh');
    const script =
      '#!/bin/sh\n' +
      'case "$1" in\n' +
      '  *Username*) echo "x-oauth-basic" ;;\n' +
      '  *)        echo "$GIT_TOKEN" ;;\n' +
      'esac\n';
    await writeFile(askpassPath, script, { mode: 0o700 });
    env.GIT_ASKPASS = askpassPath;
    env.GIT_TOKEN = opts.token;
  }

  return new Promise((resolve, reject) => {
    const child = spawn('git', opts.args, {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    const onAbort = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1000).unref();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (askpassDir) void rm(askpassDir, { recursive: true, force: true }).catch(() => undefined);
      reject(new GitError(err.message, null, stderr));
    });
    child.on('exit', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (askpassDir) void rm(askpassDir, { recursive: true, force: true }).catch(() => undefined);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new GitError(
            `git ${opts.args.join(' ')} exited ${code}: ${stderr.trim().slice(0, 500)}`,
            code,
            stderr,
          ),
        );
      }
    });
  });
}

export async function gitFetch(
  cwd: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['fetch', '--prune', 'origin'], token, signal });
}

export async function gitCheckout(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['checkout', branch], signal });
}

export async function gitResetHard(
  cwd: string,
  ref: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['reset', '--hard', ref], signal });
}

export async function gitPull(
  cwd: string,
  remote: string,
  branch: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['pull', remote, branch], token, signal });
}

export async function gitCreateBranch(
  cwd: string,
  branchName: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['checkout', '-B', branchName], signal });
}

export async function gitDeleteLocalBranchIfExists(
  cwd: string,
  branchName: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await runGit({ cwd, args: ['branch', '-D', branchName], signal });
  } catch {
    // not present — fine
  }
}

export async function gitPush(
  cwd: string,
  remote: string,
  branch: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({ cwd, args: ['push', remote, branch], token, signal });
}

export async function gitReadHeadMessage(
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await runGit({
    cwd,
    args: ['log', '-1', '--format=%B'],
    signal,
  });
  return stdout.replace(/\n+$/, '');
}

export async function gitAmendCommitMessage(
  cwd: string,
  message: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGit({
    cwd,
    args: ['commit', '--amend', '--no-edit', '-m', message],
    signal,
  });
}

export async function gitCommitsSinceBase(
  cwd: string,
  baseBranch: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const { stdout } = await runGit({
    cwd,
    args: ['log', '--format=%H', `${baseBranch}..HEAD`],
    signal,
  });
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}
