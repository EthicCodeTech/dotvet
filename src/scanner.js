import fs from 'fs';
import path from 'path';

const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'venv',
  '.venv',
  'env',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.pytest_cache',
  '__pycache__',
  'vendor',
  '.idea',
  '.vscode',
  'target',
  'tmp',
  'web',
  'site',
  'docs',
  'tests',
  'test',
  '__tests__',
  'fixtures'
]);

const VALID_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.php',
  '.sh', '.bash', '.zsh'
]);

const SPECIAL_FILENAMES = new Set([
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml'
]);

// Scoped pattern definitions by language/file type
const JS_PATTERNS = [
  { regex: /process\.env\.([A-Z0-9_]+)/g, extract: m => m[1] },
  { regex: /process\.env\[['"]([A-Z0-9_]+)['"]\]/g, extract: m => m[1] },
  { regex: /import\.meta\.env\.([A-Z0-9_]+)/g, extract: m => m[1] }
];

const PYTHON_PATTERNS = [
  { regex: /os\.environ\.get\(\s*['"]([A-Z0-9_]+)['"]/g, extract: m => m[1] },
  { regex: /os\.getenv\(\s*['"]([A-Z0-9_]+)['"]/g, extract: m => m[1] },
  { regex: /os\.environ\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g, extract: m => m[1] }
];

const GO_PATTERNS = [
  { regex: /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z0-9_]+)"\s*\)/g, extract: m => m[1] }
];

const PHP_PATTERNS = [
  { regex: /(?<![\.\$])\bgetenv\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g, extract: m => m[1] },
  { regex: /\$_(?:ENV|SERVER)\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g, extract: m => m[1] }
];

const SHELL_PATTERNS = [
  { regex: /\$\{([A-Z0-9_]{3,})\}/g, extract: m => m[1] },
  { regex: /^ENV\s+([A-Z0-9_]+)/gm, extract: m => m[1] }
];

const SYSTEM_IGNORES = new Set([
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'TERM',
  'LANG',
  'TMPDIR',
  'SHLVL',
  'CI',
  'GITHUB_ACTIONS',
  'VERCEL',
  'NETLIFY'
]);

function getPatternsForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);

  if (basename === 'Dockerfile') {
    return SHELL_PATTERNS;
  }
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'].includes(ext)) {
    return JS_PATTERNS;
  }
  if (['.py', '.pyw'].includes(ext)) {
    return PYTHON_PATTERNS;
  }
  if (ext === '.go') {
    return GO_PATTERNS;
  }
  if (ext === '.php') {
    return PHP_PATTERNS;
  }
  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    return SHELL_PATTERNS;
  }
  return [];
}

/**
 * Recursively find all eligible files in a directory.
 */
export function findFiles(dir, rootDir = dir, customIgnores = []) {
  const ignoreSet = new Set([...DEFAULT_IGNORES, ...customIgnores]);
  const results = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignoreSet.has(entry.name) && !entry.name.startsWith('.')) {
        results.push(...findFiles(fullPath, rootDir, customIgnores));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VALID_EXTENSIONS.has(ext) || SPECIAL_FILENAMES.has(entry.name)) {
        if (entry.name.endsWith('.min.js') || entry.name.endsWith('.lock') || entry.name === 'package-lock.json') {
          continue;
        }
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Scan a single file for env variable usages.
 */
export function scanFile(filePath, rootDir = process.cwd()) {
  const matches = [];
  const patterns = getPatternsForFile(filePath);
  if (patterns.length === 0) return matches;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return matches;
  }

  const lines = content.split(/\r?\n/);
  const relPath = path.relative(rootDir, filePath);

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      return;
    }

    for (const { regex, extract } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        const varName = extract(match);
        if (varName && !SYSTEM_IGNORES.has(varName) && /^[A-Z][A-Z0-9_]*$/.test(varName)) {
          matches.push({
            name: varName,
            file: relPath,
            line: lineNum,
            snippet: lineText.trim()
          });
        }
      }
    }
  });

  return matches;
}

/**
 * Read ignore patterns from .gitignore if present.
 */
export function loadGitignorePatterns(rootDir) {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.replace(/^\//, '').replace(/\/$/, ''));
  } catch {
    return [];
  }
}

/**
 * Scan entire codebase starting at rootDir.
 */
export function scanCodebase(rootDir = process.cwd(), customIgnores = []) {
  const gitignorePatterns = loadGitignorePatterns(rootDir);
  const files = findFiles(rootDir, rootDir, [...gitignorePatterns, ...customIgnores]);
  const varMap = new Map();

  for (const file of files) {
    const hits = scanFile(file, rootDir);
    for (const hit of hits) {
      if (!varMap.has(hit.name)) {
        varMap.set(hit.name, {
          name: hit.name,
          occurrences: []
        });
      }
      varMap.get(hit.name).occurrences.push({
        file: hit.file,
        line: hit.line,
        snippet: hit.snippet
      });
    }
  }

  return varMap;
}
