import os
import re
import secrets
from typing import Dict, List, Any
from .validator import parse_dotenv, is_placeholder
from .generator import infer_var_meta

JWT_NAME_REGEX = re.compile(r"(?:JWT|JWT[-_]?SECRET|ACCESS[-_]?TOKEN[-_]?SECRET|REFRESH[-_]?TOKEN[-_]?SECRET)", re.I)
SECRET_NAME_REGEX = re.compile(r"(?:SECRET|TOKEN|KEY|PASSWD|PASSWORD|AUTH|PRIVATE|CREDENTIAL|SIGNING)", re.I)


def generate_secure_secret(byte_length: int = 32) -> str:
    """Generate a cryptographically secure random hex secret."""
    return secrets.token_hex(byte_length)


def fix_env(
    discovered_vars: Dict[str, Any],
    root_dir: str = ".",
    env_file_path: str = ".env",
) -> Dict[str, Any]:
    """Auto-fix environment configuration issues."""
    full_env_path = os.path.join(root_dir, env_file_path)
    actions = []

    # 1. Ensure .env is in .gitignore (create .gitignore if missing)
    gitignore_path = os.path.join(root_dir, ".gitignore")
    if os.path.exists(gitignore_path):
        try:
            with open(gitignore_path, "r", encoding="utf-8") as f:
                lines = [l.strip() for l in f.readlines()]
            is_gitignored = any(
                l in {".env", "*.env", f"/{env_file_path}", env_file_path}
                or l.startswith(".env*")
                for l in lines
            )
            if not is_gitignored:
                with open(gitignore_path, "a", encoding="utf-8") as f:
                    f.write(f"\n{env_file_path}\n")
                actions.append({
                    "type": "GITIGNORE_ADDED",
                    "message": f"Added {env_file_path} to .gitignore to prevent secret leaks",
                })
        except Exception:
            pass
    else:
        try:
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write(f"{env_file_path}\n.env*.local\n")
            actions.append({
                "type": "GITIGNORE_CREATED",
                "message": f"Created .gitignore and added {env_file_path} to prevent secret leaks",
            })
        except Exception:
            pass

    # 2. Read or initialize .env
    env_content = ""
    env_values = {}
    if os.path.exists(full_env_path):
        try:
            with open(full_env_path, "r", encoding="utf-8") as f:
                env_content = f.read()
            env_values = parse_dotenv(env_content)
        except Exception:
            pass
    else:
        actions.append({"type": "ENV_CREATED", "message": f"Created new {env_file_path} file"})

    updated_lines = env_content.splitlines() if env_content else []

    # 3. Fix existing lines in .env
    for idx, line in enumerate(updated_lines):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue

        is_export = False
        work_line = trimmed
        if work_line.startswith("export "):
            is_export = True
            work_line = work_line[7:].strip()

        eq_idx = work_line.find("=")
        if eq_idx == -1:
            continue

        key = work_line[:eq_idx].strip()
        val = work_line[eq_idx + 1:].strip()

        if val.startswith('"') or val.startswith("'"):
            q = val[0]
            close = val.find(q, 1)
            if close != -1:
                val = val[1:close]

        needs_new_secret = False
        reason = ""

        if JWT_NAME_REGEX.search(key):
            if len(val) < 32 or is_placeholder(val):
                needs_new_secret = True
                reason = "regenerated 64-char (32-byte) cryptographically secure JWT secret"
        elif SECRET_NAME_REGEX.search(key):
            if len(val) < 16 or is_placeholder(val) or val == "":
                needs_new_secret = True
                reason = "replaced weak secret with secure 32-byte token"
        elif is_placeholder(val) or val == "":
            meta = infer_var_meta(key)
            is_conn_url = meta.get("type") == "url" or "URL" in key or "URI" in key
            new_val = meta.get("example", "default_value")
            if is_conn_url:
                actions.append({
                    "type": "CONFIG_TEMPLATE_SET",
                    "key": key,
                    "message": f'{key}: Inserted connection template ("{new_val}"). ⚠️ MANUAL_CONFIG_REQUIRED: Update with your real database credentials.'
                })
            else:
                actions.append({"type": "VALUE_UPDATED", "key": key, "message": f"Replaced placeholder for {key}"})
            prefix = "export " if is_export else ""
            updated_lines[idx] = f"{prefix}{key}={new_val}"
            continue

        if needs_new_secret:
            new_secret = generate_secure_secret(32)
            actions.append({"type": "SECRET_GENERATED", "key": key, "message": f"{key}: {reason}"})
            prefix = "export " if is_export else ""
            updated_lines[idx] = f"{prefix}{key}={new_secret}"

    # 4. Append missing variables discovered in codebase
    missing_to_append = []
    for var_name in discovered_vars:
        if var_name not in env_values:
            if JWT_NAME_REGEX.search(var_name) or SECRET_NAME_REGEX.search(var_name):
                val_to_set = generate_secure_secret(32)
                actions.append({"type": "VAR_ADDED", "key": var_name, "message": f"Generated secure secret for {var_name}"})
            else:
                meta = infer_var_meta(var_name)
                val_to_set = meta.get("example", "value")
                is_url = meta.get("type") == "url" or "URL" in var_name or "URI" in var_name
                if is_url:
                    actions.append({
                        "type": "VAR_ADDED",
                        "key": var_name,
                        "message": f"Added connection template for {var_name}. ⚠️ MANUAL_CONFIG_REQUIRED"
                    })
                else:
                    actions.append({"type": "VAR_ADDED", "key": var_name, "message": f"Added default value for {var_name}"})
            missing_to_append.append(f"{var_name}={val_to_set}")

    if missing_to_append:
        if updated_lines and updated_lines[-1] != "":
            updated_lines.append("")
        updated_lines.append("# Added automatically by dotvet --fix")
        updated_lines.extend(missing_to_append)

    with open(full_env_path, "w", encoding="utf-8") as f:
        f.write("\n".join(updated_lines) + "\n")

    return {
        "envFilePath": env_file_path,
        "actions": actions,
        "fixedCount": len(actions),
    }
