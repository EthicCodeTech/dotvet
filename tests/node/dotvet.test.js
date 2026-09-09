import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseDotenv, calculateEntropy, isPlaceholder, validateEnv } from '../../src/validator.js';
import { inferVarMeta, generateEnvExample, generateSchema } from '../../src/generator.js';
import { fixEnv } from '../../src/fixer.js';
import { scanGitHistory } from '../../src/gitRecon.js';
import { installGitHook } from '../../src/hook.js';
import { execSync } from 'child_process';

describe('Validator & Security Rules (Node)', () => {
  test('parseDotenv correctly parses keys, values, quotes, and comments', () => {
    const raw = `
      # Header comment
      PORT=3000
      APP_NAME="My Cool App"
      DB_PASS='super#secret' # inline comment
      export INLINE_VAR=hello
      EMPTY_VAR=
    `;
    const parsed = parseDotenv(raw);
    assert.strictEqual(parsed.PORT, '3000');
    assert.strictEqual(parsed.APP_NAME, 'My Cool App');
    assert.strictEqual(parsed.DB_PASS, 'super#secret');
    assert.strictEqual(parsed.INLINE_VAR, 'hello');
    assert.strictEqual(parsed.EMPTY_VAR, '');
  });

  test('isPlaceholder identifies dangerous default placeholders', () => {
    assert.strictEqual(isPlaceholder('changeme'), true);
    assert.strictEqual(isPlaceholder('your-secret-here'), true);
    assert.strictEqual(isPlaceholder('YOUR_API_KEY_HERE'), true);
    assert.strictEqual(isPlaceholder('dummy'), true);
    assert.strictEqual(isPlaceholder('123456'), true);
    assert.strictEqual(isPlaceholder('password'), true);
    assert.strictEqual(isPlaceholder('a9f1c7d8b2e34567890123456789abcd'), false);
  });

  test('calculateEntropy distinguishes high entropy secrets from repetitive patterns', () => {
    const low = calculateEntropy('aaaaaaaaaaaaa');
    const high = calculateEntropy('q8Z!9xL#2mP$0vT@');
    assert.strictEqual(low, 0);
    assert.ok(high > 3.0, 'High entropy string should be > 3.0 bits/char');
  });

  test('JWT secret under 32 characters triggers hard error', () => {
    const discovered = new Map([
      ['JWT_SECRET', { occurrences: [{ file: 'auth.js', line: 10, snippet: 'process.env.JWT_SECRET' }] }]
    ]);
    const env = { JWT_SECRET: 'short_weak_secret' }; // 17 chars, < 32
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].rule, 'JWT_UNDERSIZED');
  });

  test('JWT secret with >= 32 repetitive characters triggers REPETITIVE_SECRET hard error', () => {
    const discovered = new Map([
      ['JWT_SECRET', { occurrences: [{ file: 'auth.js', line: 10, snippet: 'process.env.JWT_SECRET' }] }]
    ]);
    const env = { JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }; // 32 'a's
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].rule, 'REPETITIVE_SECRET');
  });

  test('JWT secret with multi-character repeating pattern (e.g. abcdefgh*4) triggers REPETITIVE_SECRET hard error', () => {
    const discovered = new Map([
      ['JWT_SECRET', { occurrences: [{ file: 'auth.js', line: 10, snippet: 'process.env.JWT_SECRET' }] }]
    ]);
    const env = { JWT_SECRET: 'abcdefghabcdefghabcdefghabcdefgh' }; // 8-char pattern * 4
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].rule, 'REPETITIVE_SECRET');
    assert.ok(res.errors[0].message.includes('abcdefgh'));
  });

  test('JWT secret with >= 32 characters passes', () => {
    const discovered = new Map([
      ['JWT_SECRET', { occurrences: [{ file: 'auth.js', line: 10, snippet: 'process.env.JWT_SECRET' }] }]
    ]);
    const env = { JWT_SECRET: 'super_long_cryptographically_secure_jwt_secret_value_2026' };
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.errors.length, 0);
  });

  test('Missing variable triggers MISSING_ENV_VAR error', () => {
    const discovered = new Map([
      ['DATABASE_URL', { occurrences: [{ file: 'db.js', line: 4, snippet: 'process.env.DATABASE_URL' }] }]
    ]);
    const res = validateEnv({ discoveredVars: discovered, envValues: {} });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errors[0].rule, 'MISSING_ENV_VAR');
  });

  test('Template mock connection URLs trigger TEMPLATE_URL_UNCONFIGURED error', () => {
    const discovered = new Map([
      ['DATABASE_URL', { occurrences: [{ file: 'db.js', line: 4, snippet: 'process.env.DATABASE_URL' }] }]
    ]);
    const env = { DATABASE_URL: 'postgresql://user:password@localhost:5432/dbname' };
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errors[0].rule, 'TEMPLATE_URL_UNCONFIGURED');
  });

  test('Live vendor secrets (e.g. Stripe sk_live) trigger VENDOR_SECRET_EXPOSED warning', () => {
    const discovered = new Map([
      ['STRIPE_SECRET_KEY', { occurrences: [{ file: 'pay.js', line: 2, snippet: 'process.env.STRIPE_SECRET_KEY' }] }]
    ]);
    const syntheticStripe = ['sk', 'live', 'mockexampletokenfortestingonly123456789'].join('_');
    const env = { STRIPE_SECRET_KEY: syntheticStripe };
    const res = validateEnv({ discoveredVars: discovered, envValues: env });
    assert.ok(res.warnings.some(w => w.rule === 'VENDOR_SECRET_EXPOSED'));
  });

  test('Token expiry and duration variables (e.g. ACCESS_TOKEN_EXPIRY="1d") pass without false positives', () => {
    const discovered = new Map([
      ['ACCESS_TOKEN_EXPIRY', { occurrences: [{ file: 'auth.js', line: 5, snippet: 'process.env.ACCESS_TOKEN_EXPIRY' }] }],
      ['REFRESH_TOKEN_EXPIRY', { occurrences: [{ file: 'auth.js', line: 6, snippet: 'process.env.REFRESH_TOKEN_EXPIRY' }] }],
      ['JWT_EXPIRES_IN', { occurrences: [{ file: 'auth.js', line: 7, snippet: 'process.env.JWT_EXPIRES_IN' }] }],
      ['TOKEN_TTL', { occurrences: [{ file: 'auth.js', line: 8, snippet: 'process.env.TOKEN_TTL' }] }]
    ]);
    const env = {
      ACCESS_TOKEN_EXPIRY: '1d',
      REFRESH_TOKEN_EXPIRY: '10d',
      JWT_EXPIRES_IN: '24h',
      TOKEN_TTL: '3600'
    };
    const res = validateEnv({ discoveredVars: discovered, envValues: env, strict: true });
    assert.strictEqual(res.ok, true, 'Token expiry duration strings must pass strict checks');
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.warnings.length, 0);
  });

  test('loadIgnoreConfig supports .dotvetignore and CLI ignore flags', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotvet-ignore-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.dotvetignore'), 'EXEMPT_VAR\nCUSTOM_SECRET:WEAK_SECRET_LENGTH\n');
      const discovered = new Map([
        ['EXEMPT_VAR', { occurrences: [{ file: 'test.js', line: 1, snippet: 'process.env.EXEMPT_VAR' }] }],
        ['CUSTOM_SECRET', { occurrences: [{ file: 'test.js', line: 2, snippet: 'process.env.CUSTOM_SECRET' }] }]
      ]);
      const env = {
        EXEMPT_VAR: '',
        CUSTOM_SECRET: 'short'
      };
      const res = validateEnv({
        discoveredVars: discovered,
        envValues: env,
        rootDir: tmpDir,
        strict: true
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.errors.length, 0);
      assert.strictEqual(res.ignored.length, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Inline comments in .env (# dotvet-ignore) exempt variables from checks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotvet-inline-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env\n');
      const envContent = 'LEGACY_API_KEY=abc # dotvet-ignore\n';
      fs.writeFileSync(path.join(tmpDir, '.env'), envContent);
      const discovered = new Map([
        ['LEGACY_API_KEY', { occurrences: [{ file: 'api.js', line: 1, snippet: 'process.env.LEGACY_API_KEY' }] }]
      ]);
      const parsed = parseDotenv(envContent);
      const res = validateEnv({
        discoveredVars: discovered,
        envValues: parsed,
        rootDir: tmpDir,
        strict: true
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.ignored.length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Generator (Node)', () => {
  test('inferVarMeta infers types correctly', () => {
    assert.strictEqual(inferVarMeta('PORT').type, 'integer');
    assert.strictEqual(inferVarMeta('DATABASE_URL').type, 'url');
    assert.strictEqual(inferVarMeta('JWT_SECRET').type, 'secret');
    assert.strictEqual(inferVarMeta('IS_PROD').type, 'boolean');
  });

  test('generateSchema generates valid JSON with correct constraints and integer defaults', () => {
    const varMap = new Map([
      ['PORT', { name: 'PORT' }],
      ['JWT_SECRET', { name: 'JWT_SECRET' }]
    ]);
    const schemaStr = generateSchema(varMap);
    const schema = JSON.parse(schemaStr);
    assert.ok(schema.required.includes('PORT'));
    assert.ok(schema.required.includes('JWT_SECRET'));
    assert.strictEqual(schema.properties.PORT.type, 'integer');
    assert.strictEqual(schema.properties.PORT.default, 3000);
    assert.strictEqual(typeof schema.properties.PORT.default, 'number');
    assert.strictEqual(schema.properties.JWT_SECRET.minLength, 32);
  });
});

describe('Fixer (Node)', () => {
  test('fixEnv auto-generates secure secrets, replaces placeholders, and creates missing .gitignore', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotvet-test-'));
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'JWT_SECRET=changeme\nPORT=3000\n', 'utf8');

    const discovered = new Map([
      ['JWT_SECRET', { occurrences: [] }],
      ['DATABASE_URL', { occurrences: [] }]
    ]);

    const fixResult = fixEnv({
      discoveredVars: discovered,
      rootDir: tempDir,
      envFilePath: '.env'
    });

    assert.ok(fixResult.fixedCount >= 2);
    const content = fs.readFileSync(envPath, 'utf8');
    const parsed = parseDotenv(content);

    // JWT_SECRET should no longer be changeme, and must be >= 32 chars
    assert.notStrictEqual(parsed.JWT_SECRET, 'changeme');
    assert.ok(parsed.JWT_SECRET.length >= 32);
    // DATABASE_URL should have been added
    assert.ok(parsed.DATABASE_URL);

    // .gitignore should have been created with .env
    const gitignorePath = path.join(tempDir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath));
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(gitignoreContent.includes('.env'));

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('Passive Git Reconnaissance & Hooks (Node)', () => {
  test('scanGitHistory detects historical .env commits even after deletion', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotvet-git-recon-'));
    const env = { ...process.env };
    if (!env.GIT_CONFIG_GLOBAL && process.platform !== 'win32') {
      env.GIT_CONFIG_GLOBAL = '/dev/null';
    }

    try {
      execSync('git init -b main', { cwd: tempDir, env });
      execSync('git config user.name "Test"', { cwd: tempDir, env });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, env });

      // Commit 1: .env committed
      fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_KEY=123456');
      execSync('git add .env && git commit -m "add sensitive env file"', { cwd: tempDir, env });

      // Commit 2: delete .env file
      fs.unlinkSync(path.join(tempDir, '.env'));
      execSync('git add -A && git commit -m "remove env file"', { cwd: tempDir, env });

      // Commit 3: add safe .env.example
      fs.writeFileSync(path.join(tempDir, '.env.example'), 'SECRET_KEY=your_key_here');
      execSync('git add .env.example && git commit -m "add safe example"', { cwd: tempDir, env });

      const leaks = scanGitHistory(tempDir);
      assert.ok(leaks.length >= 1, 'Should detect at least 1 historical leak');
      assert.strictEqual(leaks[0].file, '.env');
      assert.ok(leaks[0].commit);
      assert.strictEqual(leaks[0].author, 'Test');
      assert.strictEqual(leaks[0].isPushed, false);

      // Verify safe example was not flagged
      assert.ok(!leaks.some(l => l.file === '.env.example'));

      // Verify validateEnv surfaces HISTORICAL_ENV_LEAK warning
      const res = validateEnv({
        discoveredVars: new Map(),
        rootDir: tempDir,
        strict: false
      });
      assert.ok(res.warnings.some(w => w.rule === 'HISTORICAL_ENV_LEAK'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('installGitHook creates both pre-commit and pre-push hooks', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotvet-hook-test-'));
    const env = { ...process.env };
    if (!env.GIT_CONFIG_GLOBAL && process.platform !== 'win32') {
      env.GIT_CONFIG_GLOBAL = '/dev/null';
    }

    try {
      execSync('git init -b main', { cwd: tempDir, env });
      const res = installGitHook(tempDir);
      assert.strictEqual(res.ok, true);

      const preCommit = path.join(tempDir, '.git', 'hooks', 'pre-commit');
      const prePush = path.join(tempDir, '.git', 'hooks', 'pre-push');

      assert.ok(fs.existsSync(preCommit), 'pre-commit hook must exist');
      assert.ok(fs.existsSync(prePush), 'pre-push hook must exist');

      const preCommitContent = fs.readFileSync(preCommit, 'utf8');
      assert.ok(preCommitContent.includes('pre-commit hook'));

      const prePushContent = fs.readFileSync(prePush, 'utf8');
      assert.ok(prePushContent.includes('pre-push'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

