import unittest
import os
import tempfile
import json
import subprocess
from dotvet.validator import (
    parse_dotenv,
    calculate_entropy,
    is_placeholder,
    validate_env,
)
from dotvet.generator import infer_var_meta, generate_schema
from dotvet.fixer import fix_env
from dotvet.git_recon import scan_git_history
from dotvet.hook import install_git_hook
from dotvet.scanner import scan_file
from dotvet.cli import run


class TestDotvetValidator(unittest.TestCase):
    def test_parse_dotenv(self):
        raw = """
        # Comment
        PORT=3000
        APP_NAME="Python App"
        DB_PASS='super#secret' # inline
        export INLINE_VAR=hello
        EMPTY_VAR=
        """
        parsed = parse_dotenv(raw)
        self.assertEqual(parsed["PORT"], "3000")
        self.assertEqual(parsed["APP_NAME"], "Python App")
        self.assertEqual(parsed["DB_PASS"], "super#secret")
        self.assertEqual(parsed["INLINE_VAR"], "hello")
        self.assertEqual(parsed["EMPTY_VAR"], "")

    def test_is_placeholder(self):
        self.assertTrue(is_placeholder("changeme"))
        self.assertTrue(is_placeholder("your-secret-here"))
        self.assertTrue(is_placeholder("dummy"))
        self.assertTrue(is_placeholder("123456"))
        self.assertFalse(is_placeholder("a9f1c7d8b2e34567890123456789abcd"))

    def test_calculate_entropy(self):
        low = calculate_entropy("aaaaaaaaaaaaa")
        high = calculate_entropy("q8Z!9xL#2mP$0vT@")
        self.assertEqual(low, 0.0)
        self.assertGreater(high, 3.0)

    def test_jwt_undersized(self):
        discovered = {
            "JWT_SECRET": {
                "occurrences": [{"file": "auth.py", "line": 5, "snippet": "os.getenv('JWT_SECRET')"}]
            }
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values={"JWT_SECRET": "short_secret_under_32"},
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errors"][0]["rule"], "JWT_UNDERSIZED")

    def test_jwt_repetitive_chars(self):
        discovered = {
            "JWT_SECRET": {
                "occurrences": [{"file": "auth.py", "line": 5, "snippet": "os.getenv('JWT_SECRET')"}]
            }
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values={"JWT_SECRET": "a" * 32},
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errors"][0]["rule"], "REPETITIVE_SECRET")

    def test_jwt_pattern_repetition(self):
        discovered = {
            "JWT_SECRET": {
                "occurrences": [{"file": "auth.py", "line": 5, "snippet": "os.getenv('JWT_SECRET')"}]
            }
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values={"JWT_SECRET": "abcdefgh" * 4},
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errors"][0]["rule"], "REPETITIVE_SECRET")
        self.assertIn("abcdefgh", res["errors"][0]["message"])

    def test_jwt_valid(self):
        discovered = {
            "JWT_SECRET": {
                "occurrences": [{"file": "auth.py", "line": 5, "snippet": "os.getenv('JWT_SECRET')"}]
            }
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values={"JWT_SECRET": "a_valid_cryptographically_secure_jwt_secret_32_chars_long"},
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["errors"]), 0)

    def test_template_url_unconfigured(self):
        discovered = {
            "DATABASE_URL": {
                "occurrences": [{"file": "db.py", "line": 5, "snippet": "os.getenv('DATABASE_URL')"}]
            }
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values={"DATABASE_URL": "postgresql://user:password@localhost:5432/dbname"},
        )
        self.assertFalse(res["ok"])
        self.assertEqual(res["errors"][0]["rule"], "TEMPLATE_URL_UNCONFIGURED")

    def test_vendor_secret_exposed(self):
        discovered = {
            "STRIPE_KEY": {
                "occurrences": [{"file": "pay.py", "line": 2, "snippet": "os.getenv('STRIPE_KEY')"}]
            }
        }
        synthetic_stripe = "_".join(["sk", "live", "mockexampletokenfortestingonly123456789"])
        res = validate_env(
            discovered_vars=discovered,
            env_values={"STRIPE_KEY": synthetic_stripe},
        )
        self.assertTrue(any(w["rule"] == "VENDOR_SECRET_EXPOSED" for w in res["warnings"]))
        self.assertEqual(len(res["errors"]), 0)

    def test_token_expiry_not_flagged_as_weak_secret(self):
        discovered = {
            "ACCESS_TOKEN_EXPIRY": {
                "occurrences": [{"file": "auth.py", "line": 1, "snippet": "os.getenv('ACCESS_TOKEN_EXPIRY')"}]
            },
            "REFRESH_TOKEN_EXPIRY": {
                "occurrences": [{"file": "auth.py", "line": 2, "snippet": "os.getenv('REFRESH_TOKEN_EXPIRY')"}]
            },
        }
        env = {
            "ACCESS_TOKEN_EXPIRY": "1d",
            "REFRESH_TOKEN_EXPIRY": "10d",
        }
        res = validate_env(
            discovered_vars=discovered,
            env_values=env,
            strict=True,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["errors"]), 0)
        self.assertEqual(len(res["warnings"]), 0)

    def test_dotvetignore_support(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            gitignore_path = os.path.join(tmp_dir, ".gitignore")
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write(".env\n")
            dotvetignore_path = os.path.join(tmp_dir, ".dotvetignore")
            with open(dotvetignore_path, "w", encoding="utf-8") as f:
                f.write("KNOWN_LEGACY_KEY\nCUSTOM_SECRET:WEAK_SECRET_LENGTH\n")

            discovered = {
                "KNOWN_LEGACY_KEY": {
                    "occurrences": [{"file": "legacy.py", "line": 1, "snippet": "os.getenv('KNOWN_LEGACY_KEY')"}]
                },
                "CUSTOM_SECRET": {
                    "occurrences": [{"file": "sec.py", "line": 1, "snippet": "os.getenv('CUSTOM_SECRET')"}]
                },
            }
            env = {
                "KNOWN_LEGACY_KEY": "short",
                "CUSTOM_SECRET": "short",
            }
            res = validate_env(
                discovered_vars=discovered,
                env_values=env,
                root_dir=tmp_dir,
                strict=True,
            )
            self.assertTrue(res["ok"])
            self.assertEqual(len(res["errors"]), 0)
            self.assertEqual(len(res.get("ignored", [])), 2)

    def test_inline_dotvet_ignore_comment(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            gitignore_path = os.path.join(tmp_dir, ".gitignore")
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write(".env\n")
            env_content = "LEGACY_API_KEY=abc # dotvet-ignore\n"
            env_path = os.path.join(tmp_dir, ".env")
            with open(env_path, "w", encoding="utf-8") as f:
                f.write(env_content)

            discovered = {
                "LEGACY_API_KEY": {
                    "occurrences": [{"file": "api.py", "line": 1, "snippet": "os.getenv('LEGACY_API_KEY')"}]
                }
            }
            parsed = parse_dotenv(env_content)
            res = validate_env(
                discovered_vars=discovered,
                env_values=parsed,
                root_dir=tmp_dir,
                strict=True,
            )
            self.assertTrue(res["ok"])
            self.assertEqual(len(res.get("ignored", [])), 1)


class TestDotvetGenerator(unittest.TestCase):
    def test_infer_var_meta(self):
        self.assertEqual(infer_var_meta("PORT")["type"], "integer")
        self.assertEqual(infer_var_meta("DATABASE_URL")["type"], "url")
        self.assertEqual(infer_var_meta("JWT_SECRET")["type"], "secret")
        self.assertEqual(infer_var_meta("IS_PROD")["type"], "boolean")

    def test_generate_schema(self):
        var_map = {
            "PORT": {"name": "PORT"},
            "JWT_SECRET": {"name": "JWT_SECRET"},
        }
        schema_json = generate_schema(var_map)
        data = json.loads(schema_json)
        self.assertIn("PORT", data["required"])
        self.assertIn("JWT_SECRET", data["required"])
        self.assertEqual(data["properties"]["PORT"]["type"], "integer")
        self.assertEqual(data["properties"]["PORT"]["default"], 3000)
        self.assertIsInstance(data["properties"]["PORT"]["default"], int)
        self.assertEqual(data["properties"]["JWT_SECRET"]["minLength"], 32)


class TestDotvetFixer(unittest.TestCase):
    def test_fix_env(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env_path = os.path.join(tmp_dir, ".env")
            with open(env_path, "w", encoding="utf-8") as f:
                f.write("JWT_SECRET=changeme\nPORT=3000\n")

            discovered = {
                "JWT_SECRET": {"occurrences": []},
                "DATABASE_URL": {"occurrences": []},
            }

            res = fix_env(
                discovered_vars=discovered,
                root_dir=tmp_dir,
                env_file_path=".env",
            )
            self.assertGreaterEqual(res["fixedCount"], 2)

            with open(env_path, "r", encoding="utf-8") as f:
                content = f.read()
            parsed = parse_dotenv(content)

            self.assertNotEqual(parsed["JWT_SECRET"], "changeme")
            self.assertGreaterEqual(len(parsed["JWT_SECRET"]), 32)
            self.assertIn("DATABASE_URL", parsed)

            gitignore_path = os.path.join(tmp_dir, ".gitignore")
            self.assertTrue(os.path.exists(gitignore_path))
            with open(gitignore_path, "r", encoding="utf-8") as f:
                git_content = f.read()
            self.assertIn(".env", git_content)


class TestPassiveGitRecon(unittest.TestCase):
    def test_scan_git_history(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = os.environ.copy()
            if "GIT_CONFIG_GLOBAL" not in env and os.name != "nt":
                env["GIT_CONFIG_GLOBAL"] = "/dev/null"

            subprocess.run(["git", "init", "-b", "main"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # Commit 1: add .env
            with open(os.path.join(tmp_dir, ".env"), "w", encoding="utf-8") as f:
                f.write("SECRET_KEY=123456\n")
            subprocess.run(["git", "add", ".env"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "commit", "-m", "add env"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # Commit 2: delete .env
            os.remove(os.path.join(tmp_dir, ".env"))
            subprocess.run(["git", "add", "-A"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "commit", "-m", "remove env"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # Commit 3: add safe .env.example
            with open(os.path.join(tmp_dir, ".env.example"), "w", encoding="utf-8") as f:
                f.write("SECRET_KEY=your_key_here\n")
            subprocess.run(["git", "add", ".env.example"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "commit", "-m", "add example"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            leaks = scan_git_history(tmp_dir)
            self.assertGreaterEqual(len(leaks), 1)
            self.assertEqual(leaks[0]["file"], ".env")
            self.assertEqual(leaks[0]["author"], "Test")
            self.assertFalse(leaks[0]["is_pushed"])

            # Verify safe example was not flagged
            self.assertFalse(any(l["file"] == ".env.example" for l in leaks))

            # Verify validate_env surfaces HISTORICAL_ENV_LEAK warning
            res = validate_env(discovered_vars={}, root_dir=tmp_dir, strict=False)
            self.assertTrue(any(w["rule"] == "HISTORICAL_ENV_LEAK" for w in res["warnings"]))

    def test_install_git_hook(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = os.environ.copy()
            if "GIT_CONFIG_GLOBAL" not in env and os.name != "nt":
                env["GIT_CONFIG_GLOBAL"] = "/dev/null"

            subprocess.run(["git", "init", "-b", "main"], cwd=tmp_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            res = install_git_hook(tmp_dir)
            self.assertTrue(res["ok"])

            pre_commit = os.path.join(tmp_dir, ".git", "hooks", "pre-commit")
            pre_push = os.path.join(tmp_dir, ".git", "hooks", "pre-push")

            self.assertTrue(os.path.exists(pre_commit))
            self.assertTrue(os.path.exists(pre_push))

            with open(pre_commit, "r", encoding="utf-8") as f:
                self.assertIn("pre-commit hook", f.read())
            with open(pre_push, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn("pre-push", content)
                self.assertIn("Force push lock", content)

    def test_dotvet_config_json(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = {
                "ignore": ["EXEMPT_VAR", "ANOTHER_VAR:WEAK_SECRET_LENGTH"],
                "rules": {
                    "JWT_UNDERSIZED": {"severity": "warn"}
                }
            }
            with open(os.path.join(tmp_dir, "dotvet.config.json"), "w", encoding="utf-8") as f:
                json.dump(config, f)
            with open(os.path.join(tmp_dir, ".env"), "w", encoding="utf-8") as f:
                f.write("EXEMPT_VAR=changeme\nANOTHER_VAR=short\n")

            discovered = {
                "EXEMPT_VAR": {"occurrences": [{"file": "app.py", "line": 1, "snippet": "os.getenv('EXEMPT_VAR')"}]},
                "ANOTHER_VAR": {"occurrences": [{"file": "app.py", "line": 2, "snippet": "os.getenv('ANOTHER_VAR')"}]},
            }

            res = validate_env(
                discovered_vars=discovered,
                env_values={"EXEMPT_VAR": "changeme", "ANOTHER_VAR": "short"},
                root_dir=tmp_dir,
            )
            self.assertEqual(len(res["errors"]), 0)


class TestDotvetCgiAndScaffold(unittest.TestCase):
    def test_cgi_filtering(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            php_file = os.path.join(tmp_dir, "index.php")
            php_content = """<?php
                $method = $_SERVER['REQUEST_METHOD'];
                $host = $_SERVER['HTTP_HOST'];
                $ua = $_SERVER['HTTP_USER_AGENT'];
                $ip = $_SERVER['REMOTE_ADDR'];
                $proxy = getenv('HTTP_PROXY');
                $db = getenv('DB_PASSWORD');
            """
            with open(php_file, "w", encoding="utf-8") as f:
                f.write(php_content)

            hits_default = scan_file(php_file, tmp_dir, include_cgi=False)
            names_default = [h["name"] for h in hits_default]

            self.assertNotIn("REQUEST_METHOD", names_default)
            self.assertNotIn("HTTP_HOST", names_default)
            self.assertNotIn("HTTP_USER_AGENT", names_default)
            self.assertNotIn("REMOTE_ADDR", names_default)
            self.assertIn("HTTP_PROXY", names_default)
            self.assertIn("DB_PASSWORD", names_default)

            hits_cgi = scan_file(php_file, tmp_dir, include_cgi=True)
            names_cgi = [h["name"] for h in hits_cgi]
            self.assertIn("REQUEST_METHOD", names_cgi)
            self.assertIn("HTTP_HOST", names_cgi)

    def test_init_command(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            gitignore_path = os.path.join(tmp_dir, ".gitignore")
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write("venv/\n")

            exit_code = run(["init", "--dir", tmp_dir])
            self.assertEqual(exit_code, 0)

            dotvetignore_path = os.path.join(tmp_dir, ".dotvetignore")
            self.assertTrue(os.path.exists(dotvetignore_path))
            with open(dotvetignore_path, "r", encoding="utf-8") as f:
                self.assertIn("Syntax:", f.read())

            with open(gitignore_path, "r", encoding="utf-8") as f:
                content = f.read()
                self.assertIn(".env", content)


if __name__ == "__main__":
    unittest.main()


