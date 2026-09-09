import unittest
import os
import tempfile
import json
from dotvet.validator import (
    parse_dotenv,
    calculate_entropy,
    is_placeholder,
    validate_env,
)
from dotvet.generator import infer_var_meta, generate_schema
from dotvet.fixer import fix_env


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


if __name__ == "__main__":
    unittest.main()
