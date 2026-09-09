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
  'tmp'
]);

const VALID_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sh', '.bash', '.zsh',
  '.yaml', '.yml',
  '.json'
]);

const SPECIAL_FILENAMES = new Set([
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  '.env.sample',
  '.env.template'
]);

// Patterns to detect environment variable references across languages
const PATTERNS = [
  // JS/TS: process.env.FOO or process.env['FOO'] or process.env["FOO"]
  {
    regex: /process\.env\.([A-Z0-9_]+)/g,
    extract: (m) => m[1]
  },
  {
    regex: /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
    extract: (m) => m[1]
  },
  // Vite / ESM: import.meta.env.VITE_FOO
  {
    regex: /import\.meta\.env\.([A-Z0-9_]+)/g,
    extract: (m) => m[1]
  },
  // Python: os.environ.get('FOO'), os.getenv('FOO'), os.environ['FOO']
  {
    regex: /os\.environ\.get\(\s*['"]([A-Z0-9_]+)['"]/g,
    extract: (m) => m[1]
  },
  {
    regex: /os\.getenv\(\s*['"]([A-Z0-9_]+)['"]/g,
    extract: (m) => m[1]
  },
  {
    regex: /os\.environ\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g,
    extract: (m) => m[1]
  },
  // Go: os.Getenv("FOO"), os.LookupEnv("FOO")
  {
    regex: /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z0-9_]+)"\s*\)/g,
    extract: (m) => m[1]
  },
  // Shell / Docker: ${VAR_NAME} or ENV VAR_NAME=...
  {
    regex: /\$\{([A-Z0-9_]{3,})\}/g,
    extract: (m) => m[1]
  },
  {
    regex: /^ENV\s+([A-Z0-9_]+)/gm,
    extract: (m) => m[1]
  }
];

// System/internal env vars to ignore from code scans
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
  'CI'
]);

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
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (!ignoreSet.has(entry.name) && !entry.name.startsWith('.')) {
        results.push(...findFiles(fullPath, rootDir, customIgnores));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VALID_EXTENSIONS.has(ext) || SPECIAL_FILENAMES.has(entry.name)) {
        // Skip package-lock, lockfiles, and minified files
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
    // Don't scan comment-only lines in JS/TS/Py
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      return;
    }

    for (const { regex, extract } of PATTERNS) {
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
 * Scan entire codebase starting at rootDir.
 * Returns a Map of varName -> { name, occurrences: [{ file, line, snippet }] }
 */
export function scanCodebase(rootDir = process.cwd(), customIgnores = []) {
  const files = findFiles(rootDir, rootDir, customIgnores);
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
