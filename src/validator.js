import fs from 'fs';
import path from 'path';
import { scanGitHistory } from './gitRecon.js';

// Known placeholder patterns commonly left in .env files
const PLACEHOLDER_PATTERNS = [
  /^changeme$/i,
  /^change[-_]?me$/i,
  /^your[-_]?(?:secret|key|token|api[-_]?key|password)[-_]?here$/i,
  /^insert[-_]?(?:secret|key|token|api[-_]?key|password)[-_]?here$/i,
  /^<.*>$/,
  /^\[.*\]$/,
  /^{.*}$/,
  /^placeholder$/i,
  /^replace[-_]?me$/i,
  /^todo$/i,
  /^fixme$/i,
  /^dummy$/i,
  /^example$/i,
  /^test(?:ing)?$/i,
  /^test[-_]?secret$/i,
  /^secret$/i,
  /^mysecret$/i,
  /^supersecret$/i,
  /^admin(?:istrator)?$/i,
  /^password(?:123)?$/i,
  /^123456(?:789)?$/,
  /^default$/i,
  /^xxx+$/i
];

// Variables ending or matching configuration, duration, lifetime, or metadata terms are not secrets
export const NON_SECRET_PATTERN = /(?:EXPIR|TTL|TIMEOUT|LIFETIME|MAX[-_]?AGE|INTERVAL|PERIOD|DURATION|UNIT|DAYS?|HOURS?|MINUTES?|SECONDS?|MILLIS|MS|ALGORITHM|ALG|ISSUER|AUDIENCE|URL|URI|HOST|PORT|ENDPOINT|DOMAIN|NAME|TYPE|MODE|HEADER|PREFIX|VERSION)/i;

export const SECRET_NAME_REGEX = /(?:SECRET|TOKEN|KEY|PASSWD|PASSWORD|AUTH|PRIVATE|CREDENTIAL|SIGNING)/i;
export const JWT_SECRET_REGEX = /(?:JWT[-_]?SECRET|ACCESS[-_]?TOKEN[-_]?SECRET|REFRESH[-_]?TOKEN[-_]?SECRET|^JWT$|^JWT[-_]?(?:KEY|SIGNING))/i;

export function isSecretVarName(varName) {
  if (!varName) return false;
  if (NON_SECRET_PATTERN.test(varName)) return false;
  return SECRET_NAME_REGEX.test(varName) || JWT_SECRET_REGEX.test(varName);
}

export function isJwtSecretVarName(varName) {
  if (!varName) return false;
  if (NON_SECRET_PATTERN.test(varName)) return false;
  return JWT_SECRET_REGEX.test(varName);
}

/**
 * Loads ignore rules from .dotvetignore, .dotvetrc, .dotvetrc.json, package.json, inline .env comments, and CLI arguments.
 */
export function loadIgnoreConfig({
  rootDir = process.cwd(),
  envFilePath = '.env',
  envContent = null,
  cliIgnores = []
} = {}) {
  const ignoredVars = new Set();
  const ignoredRules = new Set();
  const ignoredPairs = new Set();

  function addIgnoreEntry(entry) {
    if (!entry) return;
    const trimmed = String(entry).trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    if (trimmed.includes(':')) {
      const [v, r] = trimmed.split(':').map(s => s.trim());
      if (v === '*') {
        ignoredRules.add(r);
      } else if (r === '*') {
        ignoredVars.add(v);
      } else {
        ignoredPairs.add(`${v}:${r}`);
      }
    } else {
      const KNOWN_RULES = [
        'MISSING_ENV_VAR', 'EMPTY_ENV_VAR', 'PLACEHOLDER_SECRET',
        'TEMPLATE_URL_UNCONFIGURED', 'VENDOR_SECRET_EXPOSED', 'JWT_UNDERSIZED',
        'REPETITIVE_SECRET', 'LOW_ENTROPY_SECRET', 'WEAK_SECRET_LENGTH',
        'GITIGNORE_MISSING', 'HISTORICAL_ENV_LEAK'
      ];
      if (KNOWN_RULES.includes(trimmed)) {
        ignoredRules.add(trimmed);
      } else {
        ignoredVars.add(trimmed);
      }
    }
  }

  // 1. .dotvetignore file
  const dotvetignorePath = path.join(rootDir, '.dotvetignore');
  if (fs.existsSync(dotvetignorePath)) {
    try {
      const lines = fs.readFileSync(dotvetignorePath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        addIgnoreEntry(line);
      }
    } catch {
      // ignore read error
    }
  }

  // 2. .dotvetrc or .dotvetrc.json
  for (const rcName of ['.dotvetrc.json', '.dotvetrc']) {
    const rcPath = path.join(rootDir, rcName);
    if (fs.existsSync(rcPath)) {
      try {
        const rcData = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
        if (Array.isArray(rcData.ignore)) {
          rcData.ignore.forEach(addIgnoreEntry);
        }
      } catch {
        // ignore parse error
      }
    }
  }

  // 3. package.json "dotvet" config
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dotvet && Array.isArray(pkg.dotvet.ignore)) {
        pkg.dotvet.ignore.forEach(addIgnoreEntry);
      }
    } catch {
      // ignore
    }
  }

  // 4. Inline comments in .env file (e.g. `VAR=value # dotvet-ignore` or `# dotvet-ignore\nVAR=value`)
  let content = envContent;
  if (content === null) {
    const fullEnvPath = path.resolve(rootDir, envFilePath);
    if (fs.existsSync(fullEnvPath)) {
      try {
        content = fs.readFileSync(fullEnvPath, 'utf8');
      } catch {
        content = '';
      }
    }
  }
  if (content) {
    const lines = content.split(/\r?\n/);
    let prevLineHadIgnore = false;
    let prevLineRule = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        prevLineHadIgnore = false;
        prevLineRule = null;
        continue;
      }

      // Check if comment line is # dotvet-ignore or # dotvet-ignore:RULE
      const ignoreMatch = line.match(/^#\s*dotvet-ignore(?::([A-Za-z0-9_]+))?/i);
      if (ignoreMatch) {
        prevLineHadIgnore = true;
        prevLineRule = ignoreMatch[1] || null;
        continue;
      }

      let workLine = line;
      if (workLine.startsWith('export ')) {
        workLine = workLine.slice(7).trim();
      }
      const eqIdx = workLine.indexOf('=');
      if (eqIdx !== -1) {
        const key = workLine.slice(0, eqIdx).trim();
        const remainder = workLine.slice(eqIdx + 1);

        const inlineMatch = remainder.match(/#\s*dotvet-ignore(?::([A-Za-z0-9_]+))?/i);
        if (inlineMatch) {
          const rule = inlineMatch[1] || null;
          if (rule) {
            addIgnoreEntry(`${key}:${rule}`);
          } else {
            addIgnoreEntry(key);
          }
        } else if (prevLineHadIgnore) {
          if (prevLineRule) {
            addIgnoreEntry(`${key}:${prevLineRule}`);
          } else {
            addIgnoreEntry(key);
          }
        }
      }

      prevLineHadIgnore = false;
      prevLineRule = null;
    }
  }

  // 5. CLI ignores
  if (Array.isArray(cliIgnores)) {
    for (const item of cliIgnores) {
      if (typeof item === 'string') {
        item.split(',').forEach(addIgnoreEntry);
      }
    }
  }

  return {
    ignoredVars,
    ignoredRules,
    ignoredPairs,
    isIgnored(varName, ruleName) {
      if (varName && ignoredVars.has(varName)) return true;
      if (ruleName && ignoredRules.has(ruleName)) return true;
      if (varName && ruleName && ignoredPairs.has(`${varName}:${ruleName}`)) return true;
      return false;
    }
  };
}

// High-profile vendor token formats that should never be in placeholder or unencrypted code
const KNOWN_LEAK_PATTERNS = [
  { name: 'Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24,}/, example: 'sk_live_...' },
  { name: 'Stripe Test Key', regex: /sk_test_[0-9a-zA-Z]{24,}/, example: 'sk_test_...' },
  { name: 'AWS Access Key ID', regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/, example: 'AKIA...' },
  { name: 'GitHub Personal Access Token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, example: 'ghp_...' },
  { name: 'Slack Token', regex: /xox[baprs]-[0-9a-zA-Z]{10,48}/, example: 'xoxb-...' },
  { name: 'SendGrid API Key', regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/, example: 'SG....' }
];

// Placeholder or mock database / service connection URLs
const TEMPLATE_URL_PATTERNS = [
  /postgresql:\/\/(?:user|postgres|username):(?:password|pass|secret)?@localhost(?::\d+)?\/(?:dbname|mydb|database|test)/i,
  /mysql:\/\/(?:root|user|username):(?:password|pass|secret)?@localhost(?::\d+)?\/(?:dbname|mydb|database|test)/i,
  /mongodb:\/\/(?:root|user|username):(?:password|pass|secret)?@localhost(?::\d+)?\/(?:dbname|mydb|database|test)/i,
  /redis:\/\/(?::(?:password|secret)?@)?localhost(?::6379)?(?:\/0)?/i,
  /https?:\/\/example\.com(?:\/.*)?/i,
  /https?:\/\/localhost(?::\d+)?\/api/i
];

/**
 * Robust dotenv parser with quote and comment support.
 */
export function parseDotenv(content) {
  const result = {};
  if (!content) return result;

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Support `export KEY=val`
    if (line.startsWith('export ')) {
      line = line.slice(7).trim();
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    // Parse quoted values vs unquoted values with inline comments
    if (val.startsWith('"') || val.startsWith("'")) {
      const quote = val[0];
      const closeIdx = val.indexOf(quote, 1);
      if (closeIdx !== -1) {
        val = val.slice(1, closeIdx);
      }
    } else {
      const hashIdx = val.indexOf('#');
      if (hashIdx !== -1) {
        val = val.slice(0, hashIdx).trim();
      }
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Calculate Shannon Entropy of a string to detect repetitive or low-entropy secrets.
 */
export function calculateEntropy(str) {
  if (!str || str.length === 0) return 0;
  const frequencies = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const char in frequencies) {
    const p = frequencies[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Detect single-character or multi-character repeating patterns in secrets.
 * Examples: "aaaaaaaa", "abcdefghabcdefgh", "secretsecretsecret"
 */
export function detectRepeatingPattern(str) {
  if (!str || str.length < 6) return null;
  const len = str.length;

  // 1. Single character repeating (e.g. 6+ repeating chars)
  if (/^(.)\1{5,}$/.test(str)) {
    return { unit: str[0], repetitions: len, type: 'single' };
  }

  // 2. Exact periodic cycle repetition (e.g. "abcdefgh" * 4 == 32 chars)
  for (let k = 2; k <= Math.floor(len / 2); k++) {
    if (len % k === 0) {
      const unit = str.slice(0, k);
      if (unit.repeat(len / k) === str) {
        return { unit, repetitions: len / k, type: 'exact' };
      }
    }
  }

  // 3. Cyclic prefix repetition (e.g. "secret" * 5 + "se" = 32 chars)
  for (let k = 2; k <= 16 && k <= Math.floor(len / 2); k++) {
    const unit = str.slice(0, k);
    const fullCycles = Math.floor(len / k);
    const rem = len % k;
    const candidate = unit.repeat(fullCycles) + unit.slice(0, rem);
    if (candidate === str && fullCycles >= 2) {
      return { unit, repetitions: fullCycles, type: 'cycle' };
    }
  }

  // 4. Prefix pattern repeating across >= 70% of length
  for (let k = 2; k <= 16 && k <= Math.floor(len / 2); k++) {
    const unit = str.slice(0, k);
    let count = 0;
    for (let i = 0; i + k <= len; i += k) {
      if (str.slice(i, i + k) === unit) count++;
      else break;
    }
    if (count >= 2 && (count * k) / len >= 0.70) {
      return { unit, repetitions: count, type: 'partial' };
    }
  }

  return null;
}

/**
 * Check if a value is a placeholder.
 */
export function isPlaceholder(val) {
  if (!val) return false;
  const clean = val.trim();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  // Substring check for "your-key-here" style markers
  const lower = clean.toLowerCase();
  if (
    lower.includes('your-secret') ||
    lower.includes('your_secret') ||
    lower.includes('your-api-key') ||
    lower.includes('your_api_key') ||
    lower.includes('insert-key') ||
    lower.includes('insert_key') ||
    lower.includes('changeme')
  ) {
    return true;
  }
  return false;
}

/**
 * Validate variables from codebase against env values.
 */
export function validateEnv({
  discoveredVars = new Map(),
  envValues = {},
  rootDir = process.cwd(),
  envFilePath = '.env',
  strict = false,
  ignores = [],
  ignoreConfig = null
}) {
  const issues = [];
  const ignoredIssues = [];
  const valid = [];

  const cfg = ignoreConfig || loadIgnoreConfig({
    rootDir,
    envFilePath,
    cliIgnores: ignores
  });

  function addIssue(issue) {
    if (cfg.isIgnored(issue.name, issue.rule)) {
      ignoredIssues.push(issue);
    } else {
      issues.push(issue);
    }
  }

  // Combine provided env with process.env fallback (CI or host machine env)
  const mergedEnv = { ...process.env, ...envValues };

  // 1. Check gitignore safety if .env file exists
  const fullEnvPath = path.resolve(rootDir, envFilePath);
  if (fs.existsSync(fullEnvPath)) {
    const gitignorePath = path.join(rootDir, '.gitignore');
    let isGitignored = false;
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        const lines = gitignoreContent.split(/\r?\n/).map(l => l.trim());
        isGitignored = lines.some(l => l === '.env' || l === '*.env' || l.startsWith('.env*') || l === `/${envFilePath}` || l === envFilePath);
      } catch {
        // ignore read error
      }
    }
    if (!isGitignored) {
      addIssue({
        name: envFilePath,
        severity: 'WARN',
        rule: 'GITIGNORE_MISSING',
        message: `${envFilePath} is present but not explicitly listed in .gitignore. Risk of committing secrets to Git!`,
        solution: `Add "${envFilePath}" to your .gitignore file.`
      });
    }
  }

  // 1b. Passive Reconnaissance: Glance at Git history for past .env commits
  const gitLeaks = scanGitHistory(rootDir);
  for (const leak of gitLeaks) {
    const pushStatus = leak.isPushed
      ? '⚠️ PUSHED TO REMOTE'
      : 'Local only (not pushed)';
    const solution = leak.isPushed
      ? `This commit was pushed to a remote repository! If this repository is or ever becomes public, credentials in ${leak.file} WILL be scraped by automated bots in seconds. ROTATE ALL EXPOSED SECRETS IMMEDIATELY at your providers (OpenAI, AWS, MongoDB, Stripe, etc.).`
      : `This commit is currently local-only. Remove the commit or reset before pushing to your remote.`;

    addIssue({
      name: leak.file,
      severity: strict ? 'ERROR' : 'WARN',
      rule: 'HISTORICAL_ENV_LEAK',
      message: `Historical leak detected: "${leak.file}" was committed in commit ${leak.commit} by ${leak.author} on ${leak.date} ("${leak.message}"). Status: ${pushStatus}. Even if deleted later, it remains permanently stored in Git objects!`,
      solution,
      historical: leak
    });
  }

  // 2. Validate every variable discovered in the codebase
  for (const [varName, meta] of discoveredVars.entries()) {
    const val = mergedEnv[varName];
    const isProvided = val !== undefined && val !== null;
    const occurrences = meta.occurrences || [];
    const primaryLoc = occurrences[0] || { file: 'codebase', line: 1 };

    // Case A: Missing
    if (!isProvided) {
      addIssue({
        name: varName,
        severity: 'ERROR',
        rule: 'MISSING_ENV_VAR',
        message: `Variable ${varName} is required by code but is absent from ${envFilePath} and process.env.`,
        occurrences,
        solution: `Define ${varName}=<value> in ${envFilePath} or provide it in environment.`
      });
      continue;
    }

    const strVal = String(val).trim();

    // Case B: Empty value
    if (strVal === '') {
      addIssue({
        name: varName,
        severity: 'ERROR',
        rule: 'EMPTY_ENV_VAR',
        message: `Variable ${varName} is defined but has an empty value.`,
        occurrences,
        solution: `Provide a non-empty value for ${varName} in ${envFilePath}.`
      });
      continue;
    }

    // Case C1: Placeholder detection
    if (isPlaceholder(strVal)) {
      addIssue({
        name: varName,
        severity: 'ERROR',
        rule: 'PLACEHOLDER_SECRET',
        message: `Variable ${varName} is set to placeholder "${strVal}". This is dangerous for production!`,
        occurrences,
        solution: `Replace the placeholder with a secure, generated value.`
      });
      continue;
    }

    // Case C2: Template / Mock Connection URLs (e.g. postgresql://user:password@localhost:5432/dbname)
    if (TEMPLATE_URL_PATTERNS.some(pat => pat.test(strVal))) {
      addIssue({
        name: varName,
        severity: 'ERROR',
        rule: 'TEMPLATE_URL_UNCONFIGURED',
        message: `Variable ${varName} is set to an unconfigured template URL ("${strVal}"). Connection will fail in real environments!`,
        occurrences,
        solution: `Replace the template connection URL with your actual database/service credentials in ${envFilePath}.`
      });
      continue;
    }

    // Case C3: High-profile vendor secret exposure check (e.g. live AWS/Stripe tokens)
    const leakedVendor = KNOWN_LEAK_PATTERNS.find(pat => pat.regex.test(strVal));
    if (leakedVendor) {
      addIssue({
        name: varName,
        severity: 'WARN',
        rule: 'VENDOR_SECRET_EXPOSED',
        message: `Variable ${varName} contains a live ${leakedVendor.name} format. Ensure this ${envFilePath} file is NEVER committed or made public!`,
        occurrences,
        solution: `Ensure ${envFilePath} is added to .gitignore and injected via secure CI secrets manager in production.`
      });
    }

    // Case D: JWT secret length enforcement (>= 32 characters)
    if (isJwtSecretVarName(varName)) {
      if (strVal.length < 32) {
        addIssue({
          name: varName,
          severity: 'ERROR',
          rule: 'JWT_UNDERSIZED',
          message: `JWT secret ${varName} length is only ${strVal.length} chars (minimum 32 characters required for HMAC-SHA256). Weak JWT secrets can be forged in seconds!`,
          occurrences,
          solution: `Generate a 32+ char secret: "openssl rand -base64 32" or "node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))'"`
        });
        continue;
      }
    }

    // Case E: General Secret strength & entropy check (applies to secrets and JWTs)
    if (isSecretVarName(varName)) {
      // Check pattern repetition (single characters OR repeating multi-character patterns e.g. "abcdefghabcdefgh")
      const patternMatch = detectRepeatingPattern(strVal);
      if (patternMatch) {
        const desc = patternMatch.unit.length === 1 
          ? 'repeating single characters' 
          : `repeating sequence "${patternMatch.unit}"`;
        addIssue({
          name: varName,
          severity: 'ERROR',
          rule: 'REPETITIVE_SECRET',
          message: `Variable ${varName} consists of ${desc} (${patternMatch.repetitions} repetitions). Completely guessable!`,
          occurrences,
          solution: `Generate a truly random secret.`
        });
        continue;
      }

      // Check Shannon entropy
      const entropy = calculateEntropy(strVal);
      if (entropy < 2.5 && strVal.length >= 8) {
        addIssue({
          name: varName,
          severity: 'ERROR',
          rule: 'LOW_ENTROPY_SECRET',
          message: `Variable ${varName} has dangerously low entropy (${entropy.toFixed(2)} bits/char). Appears repetitive or trivial.`,
          occurrences,
          solution: `Generate a cryptographically random value with mixed alphanumeric characters.`
        });
        continue;
      }

      // If non-JWT secret is less than 16 characters
      if (!isJwtSecretVarName(varName) && strVal.length < 16) {
        addIssue({
          name: varName,
          severity: strict ? 'ERROR' : 'WARN',
          rule: 'WEAK_SECRET_LENGTH',
          message: `Sensitive variable ${varName} is only ${strVal.length} characters long (recommended: >= 16 characters).`,
          occurrences,
          solution: `Use a high-entropy string generated with a secure random generator.`
        });
        continue;
      }
    }

    valid.push({
      name: varName,
      length: strVal.length,
      isSecret: isSecretVarName(varName) || isJwtSecretVarName(varName),
      occurrences
    });
  }

  const errors = issues.filter(i => i.severity === 'ERROR');
  const warnings = issues.filter(i => i.severity === 'WARN');

  return {
    ok: errors.length === 0 && (!strict || warnings.length === 0),
    issues,
    errors,
    warnings,
    ignored: ignoredIssues,
    valid,
    totalChecked: discoveredVars.size
  };
}
