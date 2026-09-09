import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseDotenv, calculateEntropy, isPlaceholder, validateEnv } from '../../src/validator.js';
import { inferVarMeta, generateEnvExample, generateSchema } from '../../src/generator.js';
import { fixEnv } from '../../src/fixer.js';

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
