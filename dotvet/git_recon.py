import os
import subprocess
from typing import List, Dict, Any

IGNORED_EXTENSIONS = (
    ".example",
    ".sample",
    ".template",
    ".schema.json",
    ".dist",
    ".stub",
    ".default",
)

def is_safe_example_file(filename: str) -> bool:
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in IGNORED_EXTENSIONS)

def scan_git_history(root_dir: str = ".") -> List[Dict[str, Any]]:
    """
    Passively scans git commit history for any historical .env commits.
    100% read-only, non-destructive, zero mutation.
    """
    git_dir = os.path.join(root_dir, ".git")
    if not os.path.exists(git_dir):
        return []

    try:
        env = os.environ.copy()
        if "GIT_CONFIG_GLOBAL" not in env and os.name != "nt":
            env["GIT_CONFIG_GLOBAL"] = "/dev/null"

        cmd = [
            "git",
            "log",
            "--all",
            "--diff-filter=A",
            "--name-only",
            '--pretty=format:COMMIT:%h|%an|%ad|%s',
            "--date=short",
            "--",
            ".env",
            ".env.*",
            "**/.env",
            "**/.env.*",
        ]

        res = subprocess.run(
            cmd,
            cwd=root_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=4,
        )

        if res.returncode != 0 or not res.stdout.strip():
            return []

        leaks = []
        current_commit = None

        for raw_line in res.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("COMMIT:"):
                parts = line[7:].split("|")
                current_commit = {
                    "commit": parts[0] if len(parts) > 0 else "unknown",
                    "author": parts[1] if len(parts) > 1 else "unknown",
                    "date": parts[2] if len(parts) > 2 else "unknown",
                    "message": "|".join(parts[3:]) if len(parts) > 3 else "",
                }
            elif current_commit:
                filename = line
                if not is_safe_example_file(filename):
                    is_pushed = False
                    try:
                        branch_res = subprocess.run(
                            ["git", "branch", "-r", "--contains", current_commit["commit"]],
                            cwd=root_dir,
                            env=env,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL,
                            text=True,
                            timeout=2,
                        )
                        is_pushed = bool(branch_res.stdout.strip())
                    except Exception:
                        is_pushed = False

                    leaks.append({
                        "commit": current_commit["commit"],
                        "author": current_commit["author"],
                        "date": current_commit["date"],
                        "message": current_commit["message"],
                        "file": filename,
                        "is_pushed": is_pushed,
                    })

        return leaks
    except Exception:
        return []
