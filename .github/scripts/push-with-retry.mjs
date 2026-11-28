import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function parseTargetBranch(refspec) {
  const parts = String(refspec).split(':');
  const target = (parts.length > 1 ? parts[1] : parts[0]).replace(/^refs\/heads\//, '').trim();
  return target || null;
}

function isPermanentFailure(message) {
  return /authentication failed|could not read username|permission.*denied|returned error: 40[13]|protected branch hook declined/i.test(
    message,
  );
}

function isNonFastForward(message) {
  return /non-fast-forward|fetch first/i.test(message);
}

function defaultGitRunner(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function formatGitError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  return [stderr, stdout, error?.message].filter(Boolean).join('\n');
}

/**
 * Push a Git refspec with bounded retries, low-speed timeouts, and rebase recovery
 * if the remote branch advances between checkout and push.
 */
export async function pushWithRetry({
  remote = 'origin',
  refspec = 'HEAD:main',
  cwd = process.cwd(),
  maxAttempts = 4,
  baseDelayMs = 5000,
  sleepFn = delay,
  gitRunner = defaultGitRunner,
} = {}) {
  const targetBranch = parseTargetBranch(refspec);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      gitRunner(
        ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=30', 'push', remote, refspec],
        cwd,
      );
      return attempt;
    } catch (error) {
      const details = formatGitError(error);
      if (isPermanentFailure(details) || attempt === maxAttempts) {
        throw new Error(`git push ${remote} ${refspec} failed on attempt ${attempt}: ${details}`, {
          cause: error,
        });
      }

      if (isNonFastForward(details) && targetBranch) {
        console.warn(
          `Push rejected as non-fast-forward on attempt ${attempt}; rebasing onto ${remote}/${targetBranch}...`,
        );
        gitRunner(['fetch', remote, targetBranch], cwd);
        try {
          gitRunner(['rebase', `${remote}/${targetBranch}`], cwd);
        } catch (rebaseError) {
          try {
            gitRunner(['rebase', '--abort'], cwd);
          } catch {
            // Ignore cleanup failure when no rebase is in progress.
          }
          throw new Error(
            `git rebase ${remote}/${targetBranch} failed: ${formatGitError(rebaseError)}`,
            { cause: rebaseError },
          );
        }
      } else {
        console.warn(`git push attempt ${attempt}/${maxAttempts} failed; retrying...`);
      }

      const waitMs = baseDelayMs * 2 ** (attempt - 1);
      if (waitMs > 0) await sleepFn(waitMs);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [remote = 'origin', refspec = 'HEAD:main'] = process.argv.slice(2);
  await pushWithRetry({ remote, refspec });
}
