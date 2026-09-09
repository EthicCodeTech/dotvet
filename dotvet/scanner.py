import os
import re
from pathlib import Path
from typing import Dict, List, Any

DEFAULT_IGNORES = {
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "venv",
    ".venv",
    "env",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "coverage",
    ".pytest_cache",
    "__pycache__",
    "vendor",
    ".idea",
    ".vscode",
    "target",
    "tmp",
    "web",
    "site",
    "docs",
    "tests",
    "test",
    "__tests__",
    "fixtures",
}

VALID_EXTENSIONS = {
    ".js", ".mjs", ".cjs", ".jsx",
    ".ts", ".mts", ".cts", ".tsx",
    ".py", ".pyw",
    ".go",
    ".rs",
    ".php",
    ".sh", ".bash", ".zsh",
}

SPECIAL_FILENAMES = {
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
}

JS_PATTERNS = [
    re.compile(r"process\.env\.([A-Z0-9_]+)"),
    re.compile(r"process\.env\[['\"]([A-Z0-9_]+)['\"]\]"),
    re.compile(r"import\.meta\.env\.([A-Z0-9_]+)"),
]

PYTHON_PATTERNS = [
    re.compile(r"os\.environ\.get\(\s*['\"]([A-Z0-9_]+)['\"]"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Z0-9_]+)['\"]"),
    re.compile(r"os\.environ\[\s*['\"]([A-Z0-9_]+)['\"]\s*\]"),
]

GO_PATTERNS = [
    re.compile(r'os\.(?:Getenv|LookupEnv)\(\s*"([A-Z0-9_]+)"\s*\)'),
]

PHP_PATTERNS = [
    re.compile(r"(?<![\.\$])\bgetenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*\)"),
    re.compile(r"\$_(?:ENV|SERVER)\[\s*['\"]([A-Z0-9_]+)['\"]\s*\]"),
]

SHELL_PATTERNS = [
    re.compile(r"\$\{([A-Z0-9_]{3,})\}"),
    re.compile(r"^ENV\s+([A-Z0-9_]+)", re.MULTILINE),
]

SYSTEM_IGNORES = {
    "NODE_ENV",
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "PWD",
    "TERM",
    "LANG",
    "TMPDIR",
    "SHLVL",
    "CI",
    "GITHUB_ACTIONS",
    "VERCEL",
    "NETLIFY",
}


def get_patterns_for_file(file_path: str) -> List[re.Pattern]:
    ext = Path(file_path).suffix.lower()
    fname = Path(file_path).name

    if fname == "Dockerfile":
        return SHELL_PATTERNS
    if ext in {".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"}:
        return JS_PATTERNS
    if ext in {".py", ".pyw"}:
        return PYTHON_PATTERNS
    if ext == ".go":
        return GO_PATTERNS
    if ext == ".php":
        return PHP_PATTERNS
    if ext in {".sh", ".bash", ".zsh"}:
        return SHELL_PATTERNS
    return []


def find_files(root_dir: str, custom_ignores: List[str] = None) -> List[str]:
    ignore_set = DEFAULT_IGNORES | set(custom_ignores or [])
    matched_files = []
    root_path = Path(root_dir).resolve()

    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [
            d for d in dirnames
            if d not in ignore_set and not d.startswith(".")
        ]

        for fname in filenames:
            ext = Path(fname).suffix.lower()
            if ext in VALID_EXTENSIONS or fname in SPECIAL_FILENAMES:
                if fname.endswith(".min.js") or fname.endswith(".lock") or fname == "package-lock.json":
                    continue
                matched_files.append(os.path.join(dirpath, fname))

    return matched_files


def scan_file(file_path: str, root_dir: str) -> List[Dict[str, Any]]:
    matches = []
    patterns = get_patterns_for_file(file_path)
    if not patterns:
        return matches

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return matches

    lines = content.splitlines()
    rel_path = os.path.relpath(file_path, root_dir)

    for idx, line_text in enumerate(lines):
        line_num = idx + 1
        trimmed = line_text.strip()
        if trimmed.startswith("//") or trimmed.startswith("#") or trimmed.startswith("*"):
            continue

        for pattern in patterns:
            for match in pattern.finditer(line_text):
                var_name = match.group(1)
                if var_name and var_name not in SYSTEM_IGNORES and re.match(r"^[A-Z][A-Z0-9_]*$", var_name):
                    matches.append({
                        "name": var_name,
                        "file": rel_path,
                        "line": line_num,
                        "snippet": trimmed,
                    })

    return matches


def scan_codebase(root_dir: str = ".", custom_ignores: List[str] = None) -> Dict[str, Dict[str, Any]]:
    files = find_files(root_dir, custom_ignores)
    var_map: Dict[str, Dict[str, Any]] = {}

    for fpath in files:
        hits = scan_file(fpath, root_dir)
        for hit in hits:
            name = hit["name"]
            if name not in var_map:
                var_map[name] = {
                    "name": name,
                    "occurrences": [],
                }
            var_map[name]["occurrences"].append({
                "file": hit["file"],
                "line": hit["line"],
                "snippet": hit["snippet"],
            })

    return var_map
