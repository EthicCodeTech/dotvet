import fs from 'fs';
import path from 'path';
import { scanCodebase } from './scanner.js';
import { parseDotenv, validateEnv } from './validator.js';
import { writeGeneratedFiles } from './generator.js';
import { fixEnv } from './fixer.js';
import { installGitHook } from './hook.js';

// ANSI escape sequences
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m\x1b[37m',
  bgYellow: '\x1b[43m\x1b[30m',
  bgGreen: '\x1b[42m\x1b[30m'
};

const VERSION = '0.1.6';

function printHelp() {
  console.log(`
${c.bold}${c.cyan}dotvet${c.reset} ${c.dim}v${VERSION}${c.reset} — Zero-Config Env Security Scanner & Quality Gate

${c.bold}USAGE:${c.reset}
  ${c.green}npx dotvet${c.reset} [command] [options]

${c.bold}COMMANDS:${c.reset}
  ${c.cyan}check${c.reset}         Validate .env against codebase usages and security rules ${c.dim}(default)${c.reset}
  ${c.cyan}fix${c.reset}           Auto-heal .env: generate secure secrets, replace placeholders, fix gitignore
  ${c.cyan}scan${c.reset}          Discover all env variables referenced across the codebase
  ${c.cyan}generate${c.reset}      Generate .env.example and .env.schema.json from scanned code
  ${c.cyan}install-hook${c.reset}  Install Git pre-commit hook to block committing insecure secrets

${c.bold}OPTIONS:${c.reset}
  ${c.yellow}--fix${c.reset}               Automatically repair detected issues in local .env
  ${c.yellow}--env <path>${c.reset}        Path to env file to inspect ${c.dim}(default: .env)${c.reset}
  ${c.yellow}--ignore, -i <vars>${c.reset}  Ignore specific variables or rules (comma-separated, .dotvetignore supported)
  ${c.yellow}--strict${c.reset}            Treat warnings as hard failures (exit code 1)
  ${c.yellow}--ci${c.reset}                CI mode: format errors as GitHub Actions annotations
  ${c.yellow}--json${c.reset}              Emit results as machine-readable JSON
  ${c.yellow}-h, --help${c.reset}          Show help and usage guide
  ${c.yellow}-v, --version${c.reset}       Show dotvet version

${c.bold}SECURITY CHECKS:${c.reset}
  ${c.dim}•${c.reset} Banned placeholders (e.g. "changeme", "your-secret-here", "dummy")
  ${c.dim}•${c.reset} JWT secrets must be >= 32 characters (HMAC-SHA256 requirement)
  ${c.dim}•${c.reset} Weak secrets & low-entropy token detection
  ${c.dim}•${c.reset} Missing & empty variable detection
  ${c.dim}•${c.reset} Git hygiene check (.env in .gitignore)
  ${c.dim}•${c.reset} Historical git leak reconnaissance
`);
}

export function run(args = process.argv.slice(2), rootDir = process.cwd()) {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return 0;
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`dotvet v${VERSION}`);
    return 0;
  }

  const isJson = args.includes('--json');
  const isCi = args.includes('--ci') || Boolean(process.env.GITHUB_ACTIONS && !isJson);
  const isStrict = args.includes('--strict');
  const wantsFix = args.includes('--fix') || args[0] === 'fix';

  let envFilePath = '.env';
  const envArgIdx = args.indexOf('--env');
  if (envArgIdx !== -1 && args[envArgIdx + 1]) {
    envFilePath = args[envArgIdx + 1];
  }

  const ignores = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ignore' || args[i] === '-i') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        ignores.push(args[i + 1]);
        i++;
      }
    } else if (args[i].startsWith('--ignore=')) {
      ignores.push(args[i].slice(9));
    }
  }

  const subCommand = args[0] && !args[0].startsWith('-') ? args[0] : (wantsFix ? 'fix' : 'check');

  // Command: INSTALL-HOOK
  if (subCommand === 'install-hook') {
    const res = installGitHook(rootDir);
    if (res.ok) {
      console.log(`\n${c.green}✔${c.reset} Dual Git hooks installed successfully:`);
      console.log(`  • Pre-commit: ${c.bold}${res.preCommitPath || res.hookPath}${c.reset}`);
      console.log(`  • Pre-push:   ${c.bold}${res.prePushPath}${c.reset}`);
      console.log(`${c.dim}Future commits and pushes are now automatically guarded against insecure secrets and leaks.${c.reset}\n`);
      return 0;
    } else {
      console.error(`\n${c.red}✖${c.reset} ${res.error}\n`);
      return 1;
    }
  }

  // 1. Scan codebase
  const discoveredVars = scanCodebase(rootDir);

  // Command: FIX
  if (subCommand === 'fix' || wantsFix) {
    const fixResult = fixEnv({
      discoveredVars,
      rootDir,
      envFilePath,
      ignores
    });

    if (isJson) {
      console.log(JSON.stringify(fixResult, null, 2));
      return 0;
    }

    console.log(`\n${c.bold}${c.cyan}dotvet fix${c.reset} — Auto-healing environment configuration:`);
    if (fixResult.actions.length === 0) {
      console.log(`  ${c.green}✔${c.reset} Everything is already secure and configured! No fixes needed.\n`);
    } else {
      for (const act of fixResult.actions) {
        console.log(`  ${c.green}✔${c.reset} ${act.message}`);
      }
      console.log(`\n${c.bgGreen} FIXED ${c.reset} Applied ${c.bold}${fixResult.fixedCount}${c.reset} repairs to ${c.cyan}${envFilePath}${c.reset}.\n`);
    }
    return 0;
  }

  // Command: SCAN
  if (subCommand === 'scan') {
    if (isJson) {
      const output = {};
      for (const [name, meta] of discoveredVars.entries()) {
        output[name] = meta.occurrences;
      }
      console.log(JSON.stringify(output, null, 2));
      return 0;
    }

    console.log(`\n${c.bold}${c.cyan}dotvet scan${c.reset} — Discovered ${c.bold}${discoveredVars.size}${c.reset} environment variables:\n`);
    for (const [name, meta] of Array.from(discoveredVars.entries()).sort()) {
      console.log(`  ${c.green}${name}${c.reset} ${c.dim}(${meta.occurrences.length} usage${meta.occurrences.length === 1 ? '' : 's'})${c.reset}`);
      for (const occ of meta.occurrences.slice(0, 3)) {
        console.log(`    ${c.gray}↳ ${occ.file}:${occ.line}${c.reset}`);
      }
      if (meta.occurrences.length > 3) {
        console.log(`    ${c.gray}↳ ...and ${meta.occurrences.length - 3} more${c.reset}`);
      }
    }
    console.log('');
    return 0;
  }

  // Command: GENERATE
  if (subCommand === 'generate') {
    if (discoveredVars.size === 0) {
      console.log(`${c.yellow}!${c.reset} No environment variables discovered in codebase.`);
      return 0;
    }
    const { examplePath, schemaPath } = writeGeneratedFiles(rootDir, discoveredVars);
    if (isJson) {
      console.log(JSON.stringify({ examplePath, schemaPath, count: discoveredVars.size }));
      return 0;
    }
    console.log(`\n${c.green}✔${c.reset} Generated ${c.bold}.env.example${c.reset} and ${c.bold}.env.schema.json${c.reset} for ${discoveredVars.size} variables.`);
    return 0;
  }

  // Command: CHECK (default)
  let envValues = {};
  const fullEnvPath = path.resolve(rootDir, envFilePath);
  if (fs.existsSync(fullEnvPath)) {
    try {
      const content = fs.readFileSync(fullEnvPath, 'utf8');
      envValues = parseDotenv(content);
    } catch (err) {
      console.error(`${c.red}Failed to read ${envFilePath}:${c.reset} ${err.message}`);
      return 1;
    }
  }

  const result = validateEnv({
    discoveredVars,
    envValues,
    rootDir,
    envFilePath,
    strict: isStrict,
    ignores
  });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  // Header
  console.log(`\n${c.bold}dotvet${c.reset} ${c.dim}v${VERSION}${c.reset} — Auditing environment variables in ${c.cyan}${rootDir}${c.reset}`);
  console.log(`${c.dim}Environment file: ${envFilePath} (${fs.existsSync(fullEnvPath) ? 'found' : 'missing'}) | Found ${discoveredVars.size} vars in code${c.reset}\n`);

  // GitHub Actions CI annotations
  if (isCi && process.env.GITHUB_ACTIONS) {
    for (const issue of result.issues) {
      const firstOcc = issue.occurrences?.[0];
      const file = firstOcc?.file || envFilePath;
      const line = firstOcc?.line || 1;
      const level = issue.severity === 'ERROR' ? 'error' : 'warning';
      console.log(`::${level} file=${file},line=${line}::[dotvet] ${issue.rule}: ${issue.message}`);
    }
  }

  // Terminal reporting
  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      const isErr = issue.severity === 'ERROR';
      const badge = isErr ? `${c.bgRed} FAIL ${c.reset}` : `${c.bgYellow} WARN ${c.reset}`;
      const titleColor = isErr ? c.red : c.yellow;

      console.log(`${badge} ${titleColor}${c.bold}${issue.name}${c.reset} ${c.dim}(${issue.rule})${c.reset}`);
      console.log(`  ${issue.message}`);

      if (issue.occurrences && issue.occurrences.length > 0) {
        console.log(`  ${c.dim}Referenced at:${c.reset}`);
        for (const occ of issue.occurrences.slice(0, 3)) {
          console.log(`    ${c.gray}• ${occ.file}:${occ.line} ${c.dim}→ ${occ.snippet}${c.reset}`);
        }
      }

      if (issue.solution) {
        console.log(`  ${c.cyan}Fix:${c.reset} ${issue.solution}\n`);
      } else {
        console.log('');
      }
    }
  }

  // Reporting ignored issues if any
  if (result.ignored && result.ignored.length > 0) {
    console.log(`${c.dim}ℹ ${result.ignored.length} check${result.ignored.length === 1 ? '' : 's'} ignored by configuration / .dotvetignore (${Array.from(new Set(result.ignored.map(i => i.name))).join(', ')})${c.reset}\n`);
  }

  // Success list
  if (result.valid.length > 0) {
    console.log(`${c.green}${c.bold}PASSED CHECKS (${result.valid.length}):${c.reset}`);
    for (const item of result.valid) {
      const secretNote = item.isSecret ? `${c.dim}(secret verified)${c.reset}` : '';
      console.log(`  ${c.green}✔${c.reset} ${item.name} ${secretNote}`);
    }
    console.log('');
  }

  // Summary
  const errCount = result.errors.length;
  const warnCount = result.warnings.length;

  if (result.ok) {
    console.log(`${c.bgGreen} SUCCESS ${c.reset} ${c.green}${c.bold}All environment variables and secrets are secure and verified!${c.reset}\n`);
    return 0;
  } else {
    console.log(`${c.bgRed} FAILURE ${c.reset} Found ${c.red}${c.bold}${errCount} error${errCount === 1 ? '' : 's'}${c.reset}${warnCount > 0 ? ` and ${c.yellow}${warnCount} warning${warnCount === 1 ? '' : 's'}${c.reset}` : ''}.`);
    console.log(`💡 ${c.dim}Run ${c.reset}${c.cyan}npx dotvet fix${c.reset}${c.dim} to automatically repair local placeholders & secrets.${c.reset}\n`);
    return 1;
  }
}
