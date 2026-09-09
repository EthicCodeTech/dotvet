import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const IGNORED_EXTENSIONS = [
  '.example',
  '.sample',
  '.template',
  '.schema.json',
  '.dist',
  '.stub',
  '.default'
];

/**
 * Checks if a file path is a safe template/example file rather than a real secrets file.
 */
function isSafeExampleFile(filename) {
  const lower = filename.toLowerCase();
  return IGNORED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Passively scans git commit history for any historical .env commits.
 * 100% read-only, non-destructive, zero mutation.
 * 
 * @param {string} rootDir 
 * @returns {Array<{commit: string, author: string, date: string, message: string, file: string, isPushed: boolean}>}
 */
export function scanGitHistory(rootDir = process.cwd()) {
  // Check if .git directory exists or if we are inside a git worktree
  const gitDir = path.join(rootDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return [];
  }

  try {
    const env = { ...process.env };
    if (!env.GIT_CONFIG_GLOBAL && process.platform !== 'win32') {
      env.GIT_CONFIG_GLOBAL = '/dev/null';
    }

    // Fast plumbing log query: find all commits where any .env file was added
    const stdout = execSync(
      'git log --all --diff-filter=A --name-only --pretty="format:COMMIT:%h|%an|%ad|%s" --date=short -- ".env" ".env.*" "**/.env" "**/.env.*"',
      {
        cwd: rootDir,
        env,
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000
      }
    ).toString();

    if (!stdout.trim()) {
      return [];
    }

    const lines = stdout.split(/\r?\n/);
    const leaks = [];
    let currentCommit = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('COMMIT:')) {
        const parts = line.substring(7).split('|');
        currentCommit = {
          commit: parts[0] || 'unknown',
          author: parts[1] || 'unknown',
          date: parts[2] || 'unknown',
          message: parts.slice(3).join('|') || ''
        };
      } else if (currentCommit) {
        const filename = line;
        if (!isSafeExampleFile(filename)) {
          // Check if this commit exists on any remote branch
          let isPushed = false;
          try {
            const remoteBranches = execSync(
              `git branch -r --contains ${currentCommit.commit}`,
              { cwd: rootDir, env, stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }
            ).toString().trim();
            isPushed = remoteBranches.length > 0;
          } catch {
            isPushed = false;
          }

          leaks.push({
            commit: currentCommit.commit,
            author: currentCommit.author,
            date: currentCommit.date,
            message: currentCommit.message,
            file: filename,
            isPushed
          });
        }
      }
    }

    return leaks;
  } catch {
    // If git is missing or repository has no commits, gracefully return empty
    return [];
  }
}
