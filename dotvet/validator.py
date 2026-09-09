import os
import re
import math
from collections import Counter
from typing import Dict, List, Any, Optional

PLACEHOLDER_PATTERNS = [
    re.compile(r"^changeme$", re.I),
    re.compile(r"^change[-_]?me$", re.I),
    re.compile(r"^your[-_]?(?:secret|key|token|api[-_]?key|password)[-_]?here$", re.I),
    re.compile(r"^insert[-_]?(?:secret|key|token|api[-_]?key|password)[-_]?here$", re.I),
    re.compile(r"^<.*>$"),
    re.compile(r"^\[.*\]$"),
    re.compile(r"^{.*}$"),
    re.compile(r"^placeholder$", re.I),
    re.compile(r"^replace[-_]?me$", re.I),
    re.compile(r"^todo$", re.I),
    re.compile(r"^fixme$", re.I),
    re.compile(r"^dummy$", re.I),
    re.compile(r"^example$", re.I),
    re.compile(r"^test(?:ing)?$", re.I),
    re.compile(r"^test[-_]?secret$", re.I),
    re.compile(r"^secret$", re.I),
    re.compile(r"^mysecret$", re.I),
    re.compile(r"^supersecret$", re.I),
    re.compile(r"^admin(?:istrator)?$", re.I),
    re.compile(r"^password(?:123)?$", re.I),
    re.compile(r"^123456(?:789)?$"),
    re.compile(r"^default$", re.I),
    re.compile(r"^xxx+$", re.I),
]

SECRET_NAME_REGEX = re.compile(r"(?:SECRET|TOKEN|KEY|PASSWD|PASSWORD|AUTH|PRIVATE|CREDENTIAL|SIGNING)", re.I)
JWT_NAME_REGEX = re.compile(r"(?:JWT|JWT[-_]?SECRET|ACCESS[-_]?TOKEN[-_]?SECRET|REFRESH[-_]?TOKEN[-_]?SECRET)", re.I)

KNOWN_LEAK_PATTERNS = [
    {"name": "Stripe Secret Key", "regex": re.compile(r"sk_live_[0-9a-zA-Z]{24,}"), "example": "sk_live_..."},
    {"name": "Stripe Test Key", "regex": re.compile(r"sk_test_[0-9a-zA-Z]{24,}"), "example": "sk_test_..."},
    {"name": "AWS Access Key ID", "regex": re.compile(r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}"), "example": "AKIA..."},
    {"name": "GitHub Personal Access Token", "regex": re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}"), "example": "ghp_..."},
    {"name": "Slack Token", "regex": re.compile(r"xox[baprs]-[0-9a-zA-Z]{10,48}"), "example": "xoxb-..."},
    {"name": "SendGrid API Key", "regex": re.compile(r"SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}"), "example": "SG...."},
]

TEMPLATE_URL_PATTERNS = [
    re.compile(r"postgresql://(?:user|postgres|username):(?:password|pass|secret)?@localhost(?::\d+)?/(?:dbname|mydb|database|test)", re.I),
    re.compile(r"mysql://(?:root|user|username):(?:password|pass|secret)?@localhost(?::\d+)?/(?:dbname|mydb|database|test)", re.I),
    re.compile(r"mongodb://(?:root|user|username):(?:password|pass|secret)?@localhost(?::\d+)?/(?:dbname|mydb|database|test)", re.I),
    re.compile(r"redis://(?::(?:password|secret)?@)?localhost(?::6379)?(?:/0)?", re.I),
    re.compile(r"https?://example\.com(?:/.*)?", re.I),
    re.compile(r"https?://localhost(?::\d+)?/api", re.I),
]


def parse_dotenv(content: str) -> Dict[str, str]:
    """Robust dotenv parser matching Node.js version."""
    result = {}
    if not content:
        return result

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[7:].strip()

        eq_idx = line.find("=")
        if eq_idx == -1:
            continue

        key = line[:eq_idx].strip()
        val = line[eq_idx + 1:].strip()

        if val.startswith('"') or val.startswith("'"):
            quote = val[0]
            close_idx = val.find(quote, 1)
            if close_idx != -1:
                val = val[1:close_idx]
        else:
            hash_idx = val.find("#")
            if hash_idx != -1:
                val = val[:hash_idx].strip()

        if key:
            result[key] = val

    return result


def calculate_entropy(s: str) -> float:
    """Calculate Shannon Entropy of string."""
    if not s:
        return 0.0
    counts = Counter(s)
    length = len(s)
    entropy = 0.0
    for count in counts.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy


def detect_repeating_pattern(s: str) -> Optional[Dict[str, Any]]:
    """Detect single-character or multi-character repeating patterns in secrets.
    
    Examples: 'aaaaaaaa', 'abcdefghabcdefgh', 'secretsecretsecret'
    """
    if not s or len(s) < 6:
        return None
    length = len(s)

    # 1. Single character repeating (e.g. 6+ repeating chars)
    if len(set(s)) == 1:
        return {"unit": s[0], "repetitions": length, "type": "single"}

    # 2. Exact periodic cycle repetition (e.g. 'abcdefgh' * 4 == 32 chars)
    for k in range(2, length // 2 + 1):
        if length % k == 0:
            unit = s[:k]
            if unit * (length // k) == s:
                return {"unit": unit, "repetitions": length // k, "type": "exact"}

    # 3. Cyclic prefix repetition (e.g. 'secret' * 5 + 'se' = 32 chars)
    for k in range(2, min(17, length // 2 + 1)):
        unit = s[:k]
        full_cycles = length // k
        rem = length % k
        candidate = (unit * full_cycles) + unit[:rem]
        if candidate == s and full_cycles >= 2:
            return {"unit": unit, "repetitions": full_cycles, "type": "cycle"}

    # 4. Prefix pattern repeating across >= 70% of length
    for k in range(2, min(17, length // 2 + 1)):
        unit = s[:k]
        count = 0
        for i in range(0, length - k + 1, k):
            if s[i:i + k] == unit:
                count += 1
            else:
                break
        if count >= 2 and (count * k) / length >= 0.70:
            return {"unit": unit, "repetitions": count, "type": "partial"}

    return None


def is_placeholder(val: str) -> bool:
    """Check if value is a known dummy/placeholder."""
    if not val:
        return False
    clean = val.strip()
    for pat in PLACEHOLDER_PATTERNS:
        if pat.match(clean):
            return True

    lower = clean.lower()
    markers = [
        "your-secret", "your_secret", "your-api-key",
        "your_api_key", "insert-key", "insert_key", "changeme"
    ]
    return any(m in lower for m in markers)


def validate_env(
    discovered_vars: Dict[str, Dict[str, Any]],
    env_values: Dict[str, str],
    root_dir: str = ".",
    env_file_path: str = ".env",
    strict: bool = False,
) -> Dict[str, Any]:
    """Validate discovered vars against actual environment values."""
    issues = []
    valid = []

    # Merge process env and provided .env
    merged_env = dict(os.environ)
    merged_env.update(env_values)

    # 1. Check gitignore safety
    full_env_path = os.path.join(root_dir, env_file_path)
    if os.path.exists(full_env_path):
        gitignore_path = os.path.join(root_dir, ".gitignore")
        is_gitignored = False
        if os.path.exists(gitignore_path):
            try:
                with open(gitignore_path, "r", encoding="utf-8") as f:
                    lines = [l.strip() for l in f.readlines()]
                is_gitignored = any(
                    l in {".env", "*.env", f"/{env_file_path}", env_file_path}
                    or l.startswith(".env*")
                    for l in lines
                )
            except Exception:
                pass
        if not is_gitignored:
            issues.append({
                "name": env_file_path,
                "severity": "WARN",
                "rule": "GITIGNORE_MISSING",
                "message": f"{env_file_path} is present but not explicitly listed in .gitignore. Risk of committing secrets to Git!",
                "solution": f'Add "{env_file_path}" to your .gitignore file.',
            })

    # 2. Validate every variable found in code
    for var_name, meta in discovered_vars.items():
        val = merged_env.get(var_name)
        occurrences = meta.get("occurrences", [])

        # Case A: Missing
        if val is None:
            issues.append({
                "name": var_name,
                "severity": "ERROR",
                "rule": "MISSING_ENV_VAR",
                "message": f"Variable {var_name} is required by code but is absent from {env_file_path} and process.env.",
                "occurrences": occurrences,
                "solution": f"Define {var_name}=<value> in {env_file_path} or provide it in environment.",
            })
            continue

        str_val = str(val).strip()

        # Case B: Empty
        if str_val == "":
            issues.append({
                "name": var_name,
                "severity": "ERROR",
                "rule": "EMPTY_ENV_VAR",
                "message": f"Variable {var_name} is defined but has an empty value.",
                "occurrences": occurrences,
                "solution": f"Provide a non-empty value for {var_name} in {env_file_path}.",
            })
            continue

        # Case C1: Placeholder
        if is_placeholder(str_val):
            issues.append({
                "name": var_name,
                "severity": "ERROR",
                "rule": "PLACEHOLDER_SECRET",
                "message": f'Variable {var_name} is set to placeholder "{str_val}". This is dangerous for production!',
                "occurrences": occurrences,
                "solution": "Replace the placeholder with a secure, generated value.",
            })
            continue

        # Case C2: Template / Mock Connection URLs (e.g. postgresql://user:password@localhost:5432/dbname)
        if any(pat.search(str_val) for pat in TEMPLATE_URL_PATTERNS):
            issues.append({
                "name": var_name,
                "severity": "ERROR",
                "rule": "TEMPLATE_URL_UNCONFIGURED",
                "message": f'Variable {var_name} is set to an unconfigured template URL ("{str_val}"). Connection will fail in real environments!',
                "occurrences": occurrences,
                "solution": f"Replace the template connection URL with your actual database/service credentials in {env_file_path}.",
            })
            continue

        # Case C3: High-profile vendor secret exposure check (e.g. live AWS/Stripe tokens)
        leaked_vendor = next((pat for pat in KNOWN_LEAK_PATTERNS if pat["regex"].search(str_val)), None)
        if leaked_vendor:
            issues.append({
                "name": var_name,
                "severity": "WARN",
                "rule": "VENDOR_SECRET_EXPOSED",
                "message": f'Variable {var_name} contains a live {leaked_vendor["name"]} format. Ensure this {env_file_path} file is NEVER committed or made public!',
                "occurrences": occurrences,
                "solution": f"Ensure {env_file_path} is added to .gitignore and injected via secure CI secrets manager in production.",
            })

        # Case D: JWT minimum 32 chars
        if JWT_NAME_REGEX.search(var_name):
            if len(str_val) < 32:
                issues.append({
                    "name": var_name,
                    "severity": "ERROR",
                    "rule": "JWT_UNDERSIZED",
                    "message": f"JWT secret {var_name} length is only {len(str_val)} chars (minimum 32 characters required for HMAC-SHA256). Weak JWT secrets can be forged in seconds!",
                    "occurrences": occurrences,
                    "solution": 'Generate a 32+ char secret: "openssl rand -base64 32" or python -c "import secrets; print(secrets.token_hex(32))"',
                })
                continue

        # Case E: General secret strength & entropy check (applies to secrets and JWTs)
        if SECRET_NAME_REGEX.search(var_name) or JWT_NAME_REGEX.search(var_name):
            # Check pattern repetition (single characters OR repeating multi-character patterns e.g. "abcdefghabcdefgh")
            pattern_match = detect_repeating_pattern(str_val)
            if pattern_match:
                desc = (
                    "repeating single characters"
                    if len(pattern_match["unit"]) == 1
                    else f'repeating sequence "{pattern_match["unit"]}"'
                )
                issues.append({
                    "name": var_name,
                    "severity": "ERROR",
                    "rule": "REPETITIVE_SECRET",
                    "message": f'Variable {var_name} consists of {desc} ({pattern_match["repetitions"]} repetitions). Completely guessable!',
                    "occurrences": occurrences,
                    "solution": "Generate a truly random secret.",
                })
                continue

            # Check Shannon entropy
            entropy = calculate_entropy(str_val)
            if entropy < 2.5 and len(str_val) >= 8:
                issues.append({
                    "name": var_name,
                    "severity": "ERROR",
                    "rule": "LOW_ENTROPY_SECRET",
                    "message": f"Variable {var_name} has dangerously low entropy ({entropy:.2f} bits/char). Appears repetitive or trivial.",
                    "occurrences": occurrences,
                    "solution": "Generate a cryptographically random value with mixed alphanumeric characters.",
                })
                continue

            # If non-JWT secret is less than 16 characters
            if not JWT_NAME_REGEX.search(var_name) and len(str_val) < 16:
                issues.append({
                    "name": var_name,
                    "severity": "ERROR" if strict else "WARN",
                    "rule": "WEAK_SECRET_LENGTH",
                    "message": f"Sensitive variable {var_name} is only {len(str_val)} characters long (recommended: >= 16 characters).",
                    "occurrences": occurrences,
                    "solution": "Use a high-entropy string generated with a secure random generator.",
                })
                continue

        valid.append({
            "name": var_name,
            "length": len(str_val),
            "isSecret": bool(SECRET_NAME_REGEX.search(var_name) or JWT_NAME_REGEX.search(var_name)),
            "occurrences": occurrences,
        })

    errors = [i for i in issues if i["severity"] == "ERROR"]
    warnings = [i for i in issues if i["severity"] == "WARN"]

    return {
        "ok": len(errors) == 0 and (not strict or len(warnings) == 0),
        "issues": issues,
        "errors": errors,
        "warnings": warnings,
        "valid": valid,
        "totalChecked": len(discovered_vars),
    }
