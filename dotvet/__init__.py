"""dotvet: Zero-Config Environment Variable Security Scanner & Quality Gate."""

__version__ = "0.1.1"

from .scanner import scan_codebase, scan_file, find_files
from .validator import validate_env, parse_dotenv, calculate_entropy, is_placeholder
from .generator import generate_env_example, generate_schema, write_generated_files
from .fixer import fix_env, generate_secure_secret
from .hook import install_git_hook

__all__ = [
    "scan_codebase",
    "scan_file",
    "find_files",
    "validate_env",
    "parse_dotenv",
    "calculate_entropy",
    "is_placeholder",
    "generate_env_example",
    "generate_schema",
    "write_generated_files",
    "fix_env",
    "generate_secure_secret",
    "install_git_hook",
    "__version__",
]
