# Contributing to dotvet 🛡️

First off, thank you for considering contributing to **dotvet**! Open-source contributions from developers and the community make this tool better for everyone.

Whether you're fixing a bug, adding support for a new language/framework, refining regex pattern scanners, or adding a new security heuristic, we welcome your PRs!

---

## 🧭 Guiding Principles

1. **Zero Runtime Dependencies**:
   Both the Node.js package and the Python package must strictly maintain **0 external runtime dependencies**. We only use the standard library (`node:*` builtins and Python stdlib). This ensures sub-200ms execution, complete immunity to supply chain attacks, and zero installation friction.
2. **1:1 Parity**:
   Every feature, CLI flag, exit code, and security check must behave identically in both the Node.js (`src/`) and Python (`dotvet/`) implementations.
3. **Batteries Included & Zero Config**:
   `dotvet` should work out-of-the-box with sane, secure defaults without requiring developers to write complex config files.

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Python**: 3.8 or higher
- **Git**

### Clone the Repository
```bash
git clone https://github.com/EthicCodeTech/dotvet.git
cd dotvet
```

### Running Tests

#### Node.js Test Suite
We use Node's native test runner (no Jest/Vitest needed):
```bash
npm test
```

#### Python Test Suite
We use Python's standard `unittest`:
```bash
python3 -m unittest discover tests/python
```

Always ensure both test suites pass before submitting a pull request!

---

## 🧪 Adding New Features or Rules

### Adding Support for a New Language
1. Add AST/regex detection pattern in:
   - `src/scanner.js` (JavaScript)
   - `dotvet/scanner.py` (Python)
2. Add corresponding test cases in:
   - `tests/node/dotvet.test.js`
   - `tests/python/test_dotvet.py`

### Adding a New Security Heuristic
1. Define the rule code (e.g. `MY_NEW_RULE`), its severity (`error` or `warn`), and diagnostic messages in:
   - `src/validator.js`
   - `dotvet/validator.py`
2. Update `.env.schema.json` generation if necessary in:
   - `src/generator.js`
   - `dotvet/generator.py`
3. Update `fixEnv` if the issue can be safely auto-healed in:
   - `src/fixer.js`
   - `dotvet/fixer.py`
4. Document the new rule in `README.md` under the **Security Rules** table.
5. Add test coverage for both positive and negative cases.

---

## 🚀 Submitting a Pull Request

1. **Fork the repo** and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. **Commit your changes** using clean conventional commit messages:
   - `feat(...)`: New feature or capability
   - `fix(...)`: Bug fix or false-positive reduction
   - `docs(...)`: Documentation improvements
   - `test(...)`: Additional test cases
3. **Verify tests**:
   ```bash
   npm test
   python3 -m unittest discover tests/python
   ```
4. **Push and open a PR** against `EthicCodeTech/dotvet:main`. Provide a clear description of the problem solved, any potential false positives considered, and test coverage added.

---

## 💬 Community & Questions

Have an idea for a new rule, or spotted a false positive in a popular framework?
- Open an **[Issue](https://github.com/EthicCodeTech/dotvet/issues)** on GitHub.
- Reach out to the maintainers at **hi@ethiccode.in**.

Thank you for helping keep developers' environments secure! 🛡️
