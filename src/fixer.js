import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseDotenv, isPlaceholder, isSecretVarName, isJwtSecretVarName, loadIgnoreConfig } from './validator.js';
import { inferVarMeta } from './generator.js';

/**
 * Generate a cryptographically secure random hex secret.
 */
export function generateSecureSecret(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Auto-fix environment configuration issues:
 * 1. Ensures .env exists.
 * 2. Adds .env to .gitignore if missing.
 * 3. Replaces placeholder, empty, or undersized JWT secrets with cryptographically random tokens.
 * 4. Appends missing variables found in code to .env with safe defaults.
 */
export function fixEnv({
  discoveredVars = new Map(),
  rootDir = process.cwd(),
  envFilePath = '.env',
  ignores = [],
  ignoreConfig = null
}) {
  const fullEnvPath = path.resolve(rootDir, envFilePath);
  const actions = [];
  const cfg = ignoreConfig || loadIgnoreConfig({ rootDir, envFilePath, cliIgnores: ignores });

  // 1. Ensure .env is in .gitignore (create .gitignore if missing)
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      const lines = gitignoreContent.split(/\r?\n/).map(l => l.trim());
      const isGitignored = lines.some(l => l === '.env' || l === '*.env' || l.startsWith('.env*') || l === `/${envFilePath}` || l === envFilePath);
      if (!isGitignored) {
        const appended = gitignoreContent.endsWith('\n') ? `${envFilePath}\n` : `\n${envFilePath}\n`;
        fs.appendFileSync(gitignorePath, appended, 'utf8');
        actions.push({ type: 'GITIGNORE_ADDED', message: `Added ${envFilePath} to .gitignore to prevent secret leaks` });
      }
    } catch {
      // ignore
    }
  } else {
    try {
      fs.writeFileSync(gitignorePath, `${envFilePath}\n.env*.local\n`, 'utf8');
      actions.push({ type: 'GITIGNORE_CREATED', message: `Created .gitignore and added ${envFilePath} to prevent secret leaks` });
    } catch {
      // ignore
    }
  }

  // 2. Read or initialize .env
  let envContent = '';
  let envValues = {};
  if (fs.existsSync(fullEnvPath)) {
    envContent = fs.readFileSync(fullEnvPath, 'utf8');
    envValues = parseDotenv(envContent);
  } else {
    actions.push({ type: 'ENV_CREATED', message: `Created new ${envFilePath} file` });
  }

  let updatedLines = envContent ? envContent.split(/\r?\n/) : [];
  const handledKeys = new Set();

  // 3. Fix existing lines in .env
  updatedLines = updatedLines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    let isExport = false;
    let workLine = trimmed;
    if (workLine.startsWith('export ')) {
      isExport = true;
      workLine = workLine.slice(7).trim();
    }

    const eqIdx = workLine.indexOf('=');
    if (eqIdx === -1) return line;

    const key = workLine.slice(0, eqIdx).trim();
    let val = workLine.slice(eqIdx + 1).trim();
    handledKeys.add(key);

    // If key is ignored by configuration or inline comment, leave untouched
    if (cfg.isIgnored(key)) {
      return line;
    }

    // Unquote if quoted
    if (val.startsWith('"') || val.startsWith("'")) {
      const q = val[0];
      const close = val.indexOf(q, 1);
      if (close !== -1) {
        val = val.slice(1, close);
      }
    }

    // Check if key needs replacement
    let needsNewSecret = false;
    let reason = '';

    if (isJwtSecretVarName(key)) {
      if (val.length < 32 || isPlaceholder(val)) {
        needsNewSecret = true;
        reason = 'regenerated 64-char (32-byte) cryptographically secure JWT secret';
      }
    } else if (isSecretVarName(key)) {
      if (val.length < 16 || isPlaceholder(val) || val === '') {
        needsNewSecret = true;
        reason = 'replaced weak secret with secure 32-byte token';
      }
    } else if (isPlaceholder(val) || val === '') {
      const meta = inferVarMeta(key);
      const isConnectionUrl = meta.type === 'url' || key.includes('URL') || key.includes('URI');
      const newVal = meta.example || 'default_value';
      if (isConnectionUrl) {
        actions.push({ 
          type: 'CONFIG_TEMPLATE_SET', 
          key, 
          message: `${key}: Inserted connection template ("${newVal}"). ⚠️ MANUAL_CONFIG_REQUIRED: Update with your real database credentials.` 
        });
      } else {
        actions.push({ type: 'VALUE_UPDATED', key, message: `Replaced placeholder for ${key}` });
      }
      return `${isExport ? 'export ' : ''}${key}=${newVal}`;
    }

    if (needsNewSecret) {
      const newSecret = generateSecureSecret(32);
      actions.push({ type: 'SECRET_GENERATED', key, message: `${key}: ${reason}` });
      return `${isExport ? 'export ' : ''}${key}=${newSecret}`;
    }

    return line;
  });

  // 4. Append missing variables discovered in codebase
  const missingToAppend = [];
  for (const [varName] of discoveredVars.entries()) {
    if (!(varName in envValues)) {
      let valToSet = '';
      if (isJwtSecretVarName(varName)) {
        valToSet = generateSecureSecret(32);
        actions.push({ type: 'VAR_ADDED', key: varName, message: `Generated secure JWT secret for ${varName}` });
      } else if (isSecretVarName(varName)) {
        valToSet = generateSecureSecret(32);
        actions.push({ type: 'VAR_ADDED', key: varName, message: `Generated secure random secret for ${varName}` });
      } else {
        const meta = inferVarMeta(varName);
        valToSet = meta.example || 'value';
        const isUrl = meta.type === 'url' || varName.includes('URL') || varName.includes('URI');
        if (isUrl) {
          actions.push({ 
            type: 'VAR_ADDED', 
            key: varName, 
            message: `Added connection template for ${varName}. ⚠️ MANUAL_CONFIG_REQUIRED` 
          });
        } else {
          actions.push({ type: 'VAR_ADDED', key: varName, message: `Added default value for ${varName}` });
        }
      }
      missingToAppend.push(`${varName}=${valToSet}`);
    }
  }

  if (missingToAppend.length > 0) {
    if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== '') {
      updatedLines.push('');
    }
    updatedLines.push('# Added automatically by dotvet --fix');
    updatedLines.push(...missingToAppend);
  }

  // Write updated .env
  fs.writeFileSync(fullEnvPath, updatedLines.join('\n') + '\n', 'utf8');

  return {
    envFilePath,
    actions,
    fixedCount: actions.length
  };
}
