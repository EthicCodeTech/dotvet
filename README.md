<div align="center">

# dotvet 🛡️

**Zero-config environment variable security scanner & quality gate.**

*Validate presence, ban dangerous placeholders, and enforce secret entropy before deploying to production.*

[![npm version](https://img.shields.io/npm/v/dotvet.svg?style=flat-square&color=38bdf8)](https://www.npmjs.com/package/dotvet)
[![PyPI version](https://img.shields.io/pypi/v/dotvet.svg?style=flat-square&color=38bdf8)](https://pypi.org/project/dotvet/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square)](#why-zero-dependencies)

</div>

---

## ⚡ The Problem: `dotenv-safe` Is Not Safe

Most tools (`dotenv-safe`, `envalid`, `zod`) only verify that a variable **exists**:

```env
# Passes dotenv-safe with flying colors:
JWT_SECRET=changeme
API_KEY=your-secret-here
```

In production, **a weak secret is worse than a missing secret**. Undersized JWT secrets (< 32 characters) allow attackers to forge tokens with HS256 brute-force dictionaries in seconds.

**`dotvet` does what other linters don't:**
1. 🔍 **Zero config**: Auto-scans your codebase (`process.env.X`, `os.environ.get('X')`, `os.getenv('X')`, `import.meta.env.X`, etc.) to find every environment variable you actually reference.
2. 🚫 **Placeholder eradication**: Detects and bans dummy defaults like `"changeme"`, `"your-secret-here"`, `"dummy"`, `"admin"`, or `"123456"`.
3. 🔐 **JWT-aware strictness**: Any secret matching `JWT` or `JWT_SECRET` must be at least **32 characters (256-bit)** or `dotvet` halts the build.
4. 🎲 **Entropy calculation**: Audits sensitive keys using Shannon entropy to catch repetitive and trivial strings.
5. 📜 **Schema generation**: Generates `.env.schema.json` and `.env.example` in a single command.
6. 🌐 **Dual-ecosystem & zero dependencies**: Works natively across Node.js (`npx dotvet`) and Python (`pip install dotvet`) with **zero third-party dependencies**.

---

## 🚀 Quickstart

### In Node.js / TypeScript Projects
Run immediately without installing:
```bash
npx dotvet
```
Or install as a dev dependency:
```bash
npm install --save-dev dotvet
# or
pnpm add -D dotvet
# or
yarn add -D dotvet
```

### In Python Projects
```bash
pip install dotvet
dotvet
```

---

## 💻 CLI Commands

### 1. `dotvet` / `dotvet check` (Default)
Audits `.env` against variables referenced in your code:
```bash
npx dotvet
# or
dotvet check --env .env.production
```

**Example Output:**
```
dotvet v0.1.0 — Auditing environment variables in /projects/my-app
Environment file: .env (found) | Found 4 vars in code

 WARN  .env (GITIGNORE_MISSING)
  .env is present but not explicitly listed in .gitignore. Risk of committing secrets to Git!
  Fix: Add ".env" to your .gitignore file.

 FAIL  JWT_SECRET (JWT_UNDERSIZED)
  JWT secret JWT_SECRET length is only 18 chars (minimum 32 characters required for HMAC-SHA256). Weak JWT secrets can be forged in seconds!
  Referenced at:
    • src/auth.ts:12 → const token = jwt.sign(payload, process.env.JWT_SECRET);
  Fix: Generate a 32+ char secret: "openssl rand -base64 32"

 FAIL  DATABASE_URL (PLACEHOLDER_SECRET)
  Variable DATABASE_URL is set to placeholder "changeme". This is dangerous for production!
  Referenced at:
    • src/db.ts:4 → const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  Fix: Replace the placeholder with a secure, generated value.

PASSED CHECKS (2):
  ✔ PORT
  ✔ REDIS_URL

 FAILURE  Found 2 errors and 1 warning.
```

---

### 2. `dotvet scan`
Inspects your entire codebase and maps out where every environment variable is used:
```bash
npx dotvet scan
```
Output:
```
dotvet scan — Discovered 3 environment variables:

  DATABASE_URL (2 usages)
    ↳ src/db.ts:4
    ↳ src/migrate.ts:10
  JWT_SECRET (1 usage)
    ↳ src/auth.ts:12
  PORT (1 usage)
    ↳ src/server.ts:8
```

---

### 3. `dotvet generate`
Automatically generates a `.env.example` file and `.env.schema.json` contract based on variables discovered across your codebase:
```bash
npx dotvet generate
```

---

## 🛡️ Security Rules

| Rule | Severity | Description |
| :--- | :--- | :--- |
| `MISSING_ENV_VAR` | **FAIL** | Variable referenced in code is absent from `.env` and environment. |
| `EMPTY_ENV_VAR` | **FAIL** | Variable is defined in `.env` but has an empty string value. |
| `PLACEHOLDER_SECRET` | **FAIL** | Value matches known placeholder strings (`"changeme"`, `"your-secret-here"`, `"dummy"`). |
| `JWT_UNDERSIZED` | **FAIL** | JWT secret is under 32 characters (violates minimum 256-bit requirement for HS256). |
| `LOW_ENTROPY_SECRET` | **WARN** / **FAIL** | Sensitive key has Shannon entropy < 2.5 bits/char (repeating or sequential keys). |
| `GITIGNORE_MISSING` | **WARN** | `.env` exists in directory but is not tracked in `.gitignore`. |

---

## ⚙️ Options & Flags

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--env <path>` | `.env` | Path to environment file to audit |
| `--strict` | `false` | Treat warnings as hard errors (non-zero exit) |
| `--ci` | `false` | Emits GitHub Actions annotations (`::error file=...`) |
| `--json` | `false` | Emits machine-readable JSON output |
| `-h, --help` | | Show usage help |
| `-v, --version`| | Display version |

---

## 🤖 CI / CD Integration (GitHub Actions)

Add `dotvet` as a gate in your pull request workflow:

```yaml
name: Security & Env Quality Gate

on: [push, pull_request]

jobs:
  env-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      # Runs zero-config audit; fails PR if secrets are weak, missing, or placeholders
      - name: Run dotvet
        run: npx dotvet --ci --strict
        env:
          # Provide your mock test secrets
          JWT_SECRET: "ci_valid_32_character_long_secret_key_12345"
          DATABASE_URL: "postgresql://ci:ci@localhost:5432/test"
          PORT: "3000"
```

---

## 📦 Publishing Tonight

### Publish to npm
```bash
npm publish --access public
```

### Publish to PyPI
```bash
python3 -m pip install --upgrade build twine
python3 -m build
python3 -m twine upload dist/*
```

---

## 🔒 Why Zero Dependencies?

Recent attacks on the open-source supply chain (such as the ChainDrop worm) demonstrated how deeply nested dependencies can introduce backdoors into developer tooling.

`dotvet` is designed from the ground up with **0 runtime dependencies** in both Node.js and Python. It runs exclusively using native language standard libraries, guaranteeing:
- Sub-200ms cold startup in CI.
- Zero transitive supply chain attack surface.
- Immunity to package manager lifecycle hook breaking changes (e.g. npm v12).

---

## 🏢 Created by EthicCode Technologies

**dotvet** is an open-source initiative designed, built, and maintained by **[EthicCode Technologies](https://ethiccode.in)**.
* Website: [ethiccode.in/dotvet](https://ethiccode.in/dotvet)
* Contact: [contact@ethiccode.in](mailto:contact@ethiccode.in)

---

## 📄 License

MIT © 2026 [EthicCode Technologies](https://ethiccode.in)
