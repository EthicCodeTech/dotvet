import fs from 'fs';
import path from 'path';

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

const SECRET_NAME_REGEX = /(?:SECRET|TOKEN|KEY|PASSWD|PASSWORD|AUTH|PRIVATE|CREDENTIAL|SIGNING)/i;
const JWT_NAME_REGEX = /(?:JWT|JWT[-_]?SECRET|ACCESS[-_]?TOKEN[-_]?SECRET|REFRESH[-_]?TOKEN[-_]?SECRET)/i;

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
  strict = false
}) {
  const issues = [];
  const valid = [];

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
      issues.push({
        name: envFilePath,
        severity: 'WARN',
        rule: 'GITIGNORE_MISSING',
        message: `${envFilePath} is present but not explicitly listed in .gitignore. Risk of committing secrets to Git!`,
        solution: `Add "${envFilePath}" to your .gitignore file.`
      });
    }
  }

  // 2. Validate every variable discovered in the codebase
  for (const [varName, meta] of discoveredVars.entries()) {
    const val = mergedEnv[varName];
    const isProvided = val !== undefined && val !== null;
    const occurrences = meta.occurrences || [];
    const primaryLoc = occurrences[0] || { file: 'codebase', line: 1 };

    // Case A: Missing
    if (!isProvided) {
      issues.push({
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
      issues.push({
        name: varName,
        severity: 'ERROR',
        rule: 'EMPTY_ENV_VAR',
        message: `Variable ${varName} is defined but has an empty value.`,
        occurrences,
        solution: `Provide a non-empty value for ${varName} in ${envFilePath}.`
      });
      continue;
    }

    // Case C: Placeholder detection
    if (isPlaceholder(strVal)) {
      issues.push({
        name: varName,
        severity: 'ERROR',
        rule: 'PLACEHOLDER_SECRET',
        message: `Variable ${varName} is set to placeholder "${strVal}". This is dangerous for production!`,
        occurrences,
        solution: `Replace the placeholder with a secure, generated value.`
      });
      continue;
    }

    // Case D: JWT secret length enforcement (>= 32 characters)
    if (JWT_NAME_REGEX.test(varName)) {
      if (strVal.length < 32) {
        issues.push({
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
    if (SECRET_NAME_REGEX.test(varName) || JWT_NAME_REGEX.test(varName)) {
      // Check pattern repetition (single characters OR repeating multi-character patterns e.g. "abcdefghabcdefgh")
      const patternMatch = detectRepeatingPattern(strVal);
      if (patternMatch) {
        const desc = patternMatch.unit.length === 1 
          ? 'repeating single characters' 
          : `repeating sequence "${patternMatch.unit}"`;
        issues.push({
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
        issues.push({
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
      if (!JWT_NAME_REGEX.test(varName) && strVal.length < 16) {
        issues.push({
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
      isSecret: SECRET_NAME_REGEX.test(varName) || JWT_NAME_REGEX.test(varName),
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
    valid,
    totalChecked: discoveredVars.size
  };
}
