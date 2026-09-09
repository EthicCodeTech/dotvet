<div align="center">

# dotvet 🛡️

**Zero-config environment variable security scanner & quality gate.**

*Validate presence, ban dangerous placeholders, and enforce secret entropy before deploying to production.*

[![npm version](https://img.shields.io/npm/v/dotvet.svg?style=flat-square&color=38bdf8)](https://www.npmjs.com/package/dotvet)
[![npm downloads](https://img.shields.io/npm/dm/dotvet.svg?style=flat-square&color=38bdf8)](https://www.npmjs.com/package/dotvet)
[![PyPI version](https://img.shields.io/pypi/v/dotvet.svg?style=flat-square&color=38bdf8)](https://pypi.org/project/dotvet/)
[![PyPI downloads](https://img.shields.io/pypi/dm/dotvet.svg?style=flat-square&color=38bdf8)](https://pypi.org/project/dotvet/)
[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-dotvet--action-blue?style=flat-square&logo=githubactions)](https://github.com/EthicCodeTech/dotvet)
[![dotvet: secure](https://ethiccode.in/dotvet/badge.svg)](https://ethiccode.in/dotvet)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square)](#why-zero-dependencies)

</div>

---

## ⚡ Why dotvet? (The Comparison)

Most environment linters (`dotenv-safe`, `envalid`) only check if a key **exists**. They don't care if its value is `"changeme"` or a 6-character toy secret that can be cracked in 2 seconds.

| Capability | `dotvet` 🛡️ | `dotenv-safe` | `dotenvx` | `gitleaks` / `trufflehog` |
| :--- | :---: | :---: | :---: | :---: |
| **Code-aware Scanning** (derives required vars from AST/regex) | ✅ **Zero-config** | ❌ (Manual `.env.example`) | ❌ | ❌ |
| **Bans Dummy Placeholders** (`changeme`, `dummy`, `test`) | ✅ **Yes** | ❌ (Passes them) | ❌ | ❌ |
| **Enforces JWT Minimum Strength** (>= 32 chars / 256-bit) | ✅ **Hard Fail** | ❌ | ❌ | ❌ |
| **Detects Unconfigured Template URLs** (`postgres://localhost...`) | ✅ **Hard Fail** | ❌ | ❌ | ❌ |
| **Entropy & Repeating Pattern Detector** (`abcdefgh`*4) | ✅ **Yes** | ❌ | ❌ | ✅ (Git history only) |
| **Auto-Heals Secrets & `.gitignore`** (`dotvet fix`) | ✅ **Yes** | ❌ | ❌ | ❌ |
| **Passive Git History Leak Reconnaissance** | ✅ **Yes (Instant)** | ❌ | ❌ | ✅ (Git commits only) |
| **Dual Git Hooks (`pre-commit` & `pre-push`)** | ✅ **Yes** | ❌ | ❌ | ⚠️ (Manual hook) |
| **Generates Machine-Readable `.env.schema.json` Contract** | ✅ **Yes** | ❌ | ❌ | ❌ |
| **Native GitHub Action** (`uses: EthicCodeTech/dotvet@v1`) | ✅ **Yes** | ❌ | ⚠️ | ⚠️ |
| **Runtime Dependencies** | **0** | Multiple | Multiple | Go binary |

---

## 🛡️ Repository Security Badge

Show your team and users that your repository is protected from insecure environment variables. Add this badge to your README:

```markdown
[![dotvet: secure](https://ethiccode.in/dotvet/badge.svg)](https://ethiccode.in/dotvet)
```

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

## 📜 Your Team's Env Contract (`.env.schema.json`)

Onboarding new engineers shouldn't require sending unencrypted `.env` files over Slack.

Run `dotvet generate` once:
```bash
npx dotvet generate
```

This derives your project's canonical environment contract:
1. **`.env.example`**: Clean documentation of all required variables without exposing production secrets.
2. **`.env.schema.json`**: Strict JSON Schema defining types (`integer`, `string`, `secret`), constraints, and descriptions.

Commit `.env.schema.json` to Git. Whenever a teammate pulls the repository or runs `dotvet check`, they immediately know which variables their branch depends on and why.

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
dotvet v0.1.1 — Auditing environment variables in /projects/my-app
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

## 🛡️ Security Rules

| Rule | Severity | Description |
| :--- | :--- | :--- |
| `MISSING_ENV_VAR` | **FAIL** | Variable referenced in code is absent from `.env` and environment. |
| `EMPTY_ENV_VAR` | **FAIL** | Variable is defined in `.env` but has an empty string value. |
| `PLACEHOLDER_SECRET` | **FAIL** | Value matches known placeholder strings (`"changeme"`, `"your-secret-here"`, `"dummy"`). |
| `JWT_UNDERSIZED` | **FAIL** | JWT secret is under 32 characters (violates minimum 256-bit requirement for HS256). |
| `LOW_ENTROPY_SECRET` | **WARN** / **FAIL** | Sensitive key has Shannon entropy < 2.5 bits/char (repeating or sequential keys). |
| `GITIGNORE_MISSING` | **WARN** | `.env` exists in directory but is not tracked in `.gitignore`. |
| `HISTORICAL_ENV_LEAK` | **WARN** / **FAIL** | A `.env` file was committed in past Git history (even if deleted now, it is stored in Git objects). |
| `TEMPLATE_URL_UNCONFIGURED` | **FAIL** | Unconfigured mock connection URL (`postgresql://user:password@localhost...`). |
| `VENDOR_SECRET_EXPOSED` | **WARN** | Live production API key pattern detected (e.g. Stripe `sk_live`). |

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

## 🤖 CI / CD Integration: GitHub Action

The fastest way to guard pull requests in GitHub Actions is the official **`dotvet` action** (3 lines):

```yaml
name: Env Security Gate

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify Environment Variable Security
        uses: EthicCodeTech/dotvet@main
        with:
          strict: 'true'
        env:
          JWT_SECRET: "ci_valid_32_character_long_secret_key_12345"
          DATABASE_URL: "postgresql://ci:ci@localhost:5432/test"
          PORT: "3000"
```

## 🔒 Why Zero Dependencies?

Recent attacks on the open-source supply chain demonstrated how deeply nested dependencies can introduce backdoors into developer tooling.

`dotvet` is designed from the ground up with **0 runtime dependencies** in both Node.js and Python. It runs exclusively using native standard libraries, guaranteeing:
- Sub-200ms cold startup in CI.
- Zero transitive supply chain attack surface.
- Full immunity to third-party package vulnerabilities.

---

## 🏢 Created by EthicCode Technologies

**dotvet** is an open-source initiative designed, built, and maintained by **[EthicCode Technologies](https://ethiccode.in)**.
* Website: [ethiccode.in/dotvet](https://ethiccode.in/dotvet)
* Contact: [hi@ethiccode.in](mailto:hi@ethiccode.in)

---

## 📄 License

MIT © 2026 [EthicCode Technologies](https://ethiccode.in)
