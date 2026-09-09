import sys
import os
import json
from typing import List

from .scanner import scan_codebase
from .validator import parse_dotenv, validate_env
from .generator import write_generated_files
from .fixer import fix_env
from .hook import install_git_hook
from . import __version__

# ANSI colors
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    CYAN = "\033[36m"
    GRAY = "\033[90m"
    BG_RED = "\033[41m\033[37m"
    BG_YELLOW = "\033[43m\033[30m"
    BG_GREEN = "\033[42m\033[30m"


def print_help():
    print(f"""
{C.BOLD}{C.CYAN}dotvet{C.RESET} {C.DIM}v{__version__}{C.RESET} — Zero-Config Env Security Scanner & Quality Gate

{C.BOLD}USAGE:{C.RESET}
  {C.GREEN}dotvet{C.RESET} [command] [options]

{C.BOLD}COMMANDS:{C.RESET}
  {C.CYAN}check{C.RESET}         Validate .env against codebase usages and security rules {C.DIM}(default){C.RESET}
  {C.CYAN}fix{C.RESET}           Auto-heal .env: generate secure secrets, replace placeholders, fix gitignore
  {C.CYAN}scan{C.RESET}          Discover all env variables referenced across the codebase
  {C.CYAN}generate{C.RESET}      Generate .env.example and .env.schema.json from scanned code
  {C.CYAN}install-hook{C.RESET}  Install Git pre-commit hook to block committing insecure secrets

{C.BOLD}OPTIONS:{C.RESET}
  {C.YELLOW}--fix{C.RESET}           Automatically repair detected issues in local .env
  {C.YELLOW}--env <path>{C.RESET}    Path to env file to inspect {C.DIM}(default: .env){C.RESET}
  {C.YELLOW}--strict{C.RESET}        Treat warnings as hard failures (exit code 1)
  {C.YELLOW}--ci{C.RESET}            CI mode: format errors as GitHub Actions annotations
  {C.YELLOW}--json{C.RESET}          Emit results as machine-readable JSON
  {C.YELLOW}-h, --help{C.RESET}      Show help and usage guide
  {C.YELLOW}-v, --version{C.RESET}   Show dotvet version

{C.BOLD}SECURITY CHECKS:{C.RESET}
  {C.DIM}•{C.RESET} Banned placeholders (e.g. "changeme", "your-secret-here", "dummy")
  {C.DIM}•{C.RESET} JWT secrets must be >= 32 characters (HMAC-SHA256 requirement)
  {C.DIM}•{C.RESET} Weak secrets & low-entropy token detection
  {C.DIM}•{C.RESET} Missing & empty variable detection
  {C.DIM}•{C.RESET} Git hygiene check (.env in .gitignore)
""")


def run(args: List[str] = None, root_dir: str = ".") -> int:
    if args is None:
        args = sys.argv[1:]

    if "-h" in args or "--help" in args:
        print_help()
        return 0

    if "-v" in args or "--version" in args:
        print(f"dotvet v{__version__}")
        return 0

    is_json = "--json" in args
    is_ci = "--ci" in args or bool(os.environ.get("GITHUB_ACTIONS") and not is_json)
    is_strict = "--strict" in args
    wants_fix = "--fix" in args or (args and args[0] == "fix")

    env_file_path = ".env"
    if "--env" in args:
        idx = args.index("--env")
        if idx + 1 < len(args):
            env_file_path = args[idx + 1]

    sub_command = "fix" if wants_fix else "check"
    for a in args:
        if not a.startswith("-"):
            sub_command = a
            break

    # Command: INSTALL-HOOK
    if sub_command == "install-hook":
        res = install_git_hook(root_dir)
        if res["ok"]:
            print(f"\n{C.GREEN}✔{C.RESET} Dual Git hooks installed successfully:")
            print(f"  • Pre-commit: {C.BOLD}{res.get('preCommitPath') or res['hookPath']}{C.RESET}")
            print(f"  • Pre-push:   {C.BOLD}{res.get('prePushPath')}{C.RESET}")
            print(f"{C.DIM}Future commits and pushes are now automatically guarded against insecure secrets and leaks.{C.RESET}\n")
            return 0
        else:
            print(f"\n{C.RED}✖{C.RESET} {res['error']}\n", file=sys.stderr)
            return 1

    # Scan codebase
    discovered_vars = scan_codebase(root_dir)

    # Command: FIX
    if sub_command == "fix" or wants_fix:
        fix_result = fix_env(
            discovered_vars=discovered_vars,
            root_dir=root_dir,
            env_file_path=env_file_path,
        )
        if is_json:
            print(json.dumps(fix_result, indent=2))
            return 0

        print(f"\n{C.BOLD}{C.CYAN}dotvet fix{C.RESET} — Auto-healing environment configuration:")
        if not fix_result["actions"]:
            print(f"  {C.GREEN}✔{C.RESET} Everything is already secure and configured! No fixes needed.\n")
        else:
            for act in fix_result["actions"]:
                print(f"  {C.GREEN}✔{C.RESET} {act['message']}")
            print(f"\n{C.BG_GREEN} FIXED {C.RESET} Applied {C.BOLD}{fix_result['fixedCount']}{C.RESET} repairs to {C.CYAN}{env_file_path}{C.RESET}.\n")
        return 0

    # Command: SCAN
    if sub_command == "scan":
        if is_json:
            output = {name: meta["occurrences"] for name, meta in discovered_vars.items()}
            print(json.dumps(output, indent=2))
            return 0

        print(f"\n{C.BOLD}{C.CYAN}dotvet scan{C.RESET} — Discovered {C.BOLD}{len(discovered_vars)}{C.RESET} environment variables:\n")
        for name in sorted(discovered_vars.keys()):
            meta = discovered_vars[name]
            occs = meta["occurrences"]
            print(f"  {C.GREEN}{name}{C.RESET} {C.DIM}({len(occs)} usage{'s' if len(occs) != 1 else ''}){C.RESET}")
            for occ in occs[:3]:
                print(f"    {C.GRAY}↳ {occ['file']}:{occ['line']}{C.RESET}")
            if len(occs) > 3:
                print(f"    {C.GRAY}↳ ...and {len(occs) - 3} more{C.RESET}")
        print()
        return 0

    # Command: GENERATE
    if sub_command == "generate":
        if not discovered_vars:
            print(f"{C.YELLOW}!{C.RESET} No environment variables discovered in codebase.")
            return 0
        example_path, schema_path = write_generated_files(root_dir, discovered_vars)
        if is_json:
            print(json.dumps({"examplePath": example_path, "schemaPath": schema_path, "count": len(discovered_vars)}))
            return 0
        print(f"\n{C.GREEN}✔{C.RESET} Generated {C.BOLD}.env.example{C.RESET} and {C.BOLD}.env.schema.json{C.RESET} for {len(discovered_vars)} variables.\n")
        return 0

    # Command: CHECK (default)
    env_values = {}
    full_env_path = os.path.join(root_dir, env_file_path)
    if os.path.exists(full_env_path):
        try:
            with open(full_env_path, "r", encoding="utf-8") as f:
                env_values = parse_dotenv(f.read())
        except Exception as e:
            print(f"{C.RED}Failed to read {env_file_path}:{C.RESET} {e}", file=sys.stderr)
            return 1

    result = validate_env(
        discovered_vars=discovered_vars,
        env_values=env_values,
        root_dir=root_dir,
        env_file_path=env_file_path,
        strict=is_strict,
    )

    if is_json:
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1

    # Header
    print(f"\n{C.BOLD}dotvet{C.RESET} {C.DIM}v{__version__}{C.RESET} — Auditing environment variables in {C.CYAN}{os.path.abspath(root_dir)}{C.RESET}")
    print(f"{C.DIM}Environment file: {env_file_path} ({'found' if os.path.exists(full_env_path) else 'missing'}) | Found {len(discovered_vars)} vars in code{C.RESET}\n")

    # GitHub Actions CI annotations
    if is_ci and os.environ.get("GITHUB_ACTIONS"):
        for issue in result["issues"]:
            occs = issue.get("occurrences", [])
            first_occ = occs[0] if occs else {}
            fpath = first_occ.get("file", env_file_path)
            line = first_occ.get("line", 1)
            level = "error" if issue["severity"] == "ERROR" else "warning"
            print(f"::{level} file={fpath},line={line}::[dotvet] {issue['rule']}: {issue['message']}")

    # Terminal reporting
    for issue in result["issues"]:
        is_err = issue["severity"] == "ERROR"
        badge = f"{C.BG_RED} FAIL {C.RESET}" if is_err else f"{C.BG_YELLOW} WARN {C.RESET}"
        title_color = C.RED if is_err else C.YELLOW

        print(f"{badge} {title_color}{C.BOLD}{issue['name']}{C.RESET} {C.DIM}({issue['rule']}){C.RESET}")
        print(f"  {issue['message']}")

        occs = issue.get("occurrences", [])
        if occs:
            print(f"  {C.DIM}Referenced at:{C.RESET}")
            for occ in occs[:3]:
                print(f"    {C.GRAY}• {occ['file']}:{occ['line']} {C.DIM}→ {occ['snippet']}{C.RESET}")

        if issue.get("solution"):
            print(f"  {C.CYAN}Fix:{C.RESET} {issue['solution']}\n")
        else:
            print()

    # Success list
    if result["valid"]:
        print(f"{C.GREEN}{C.BOLD}PASSED CHECKS ({len(result['valid'])}):{C.RESET}")
        for item in result["valid"]:
            secret_note = f"{C.DIM}(secret verified){C.RESET}" if item["isSecret"] else ""
            print(f"  {C.GREEN}✔{C.RESET} {item['name']} {secret_note}")
        print()

    # Summary
    err_count = len(result["errors"])
    warn_count = len(result["warnings"])

    if result["ok"]:
        print(f"{C.BG_GREEN} SUCCESS {C.RESET} {C.GREEN}{C.BOLD}All environment variables and secrets are secure and verified!{C.RESET}\n")
        return 0
    else:
        warn_str = f" and {C.YELLOW}{warn_count} warning{'s' if warn_count != 1 else ''}{C.RESET}" if warn_count > 0 else ""
        print(f"{C.BG_RED} FAILURE {C.RESET} Found {C.RED}{C.BOLD}{err_count} error{'s' if err_count != 1 else ''}{C.RESET}{warn_str}.")
        print(f"💡 {C.DIM}Run {C.RESET}{C.CYAN}dotvet fix{C.RESET}{C.DIM} to automatically repair local placeholders & secrets.{C.RESET}\n")
        return 1


def main():
    sys.exit(run())


if __name__ == "__main__":
    main()
