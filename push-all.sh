#!/usr/bin/env bash
set -e

# Always run from problem-solver root
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

COMMIT_MSG="${1:-Update dotvet and sync site}"

echo "=================================================="
echo "🛡️  dotvet: Unified Multi-Channel Push & Deploy"
echo "=================================================="

# 1. Run test suites
echo ""
echo "🧪 [1/5] Running test suites (Node & Python)..."
npm test
python3 -m unittest discover tests/python

# 2. Check Git status and push dotvet repo
echo ""
echo "📦 [2/5] Committing & pushing dotvet repo..."
git add -A
if git diff-index --quiet HEAD --; then
  echo "ℹ No uncommitted changes in dotvet repository."
else
  git commit -m "$COMMIT_MSG"
fi
git push origin main

# 3. Detect version and publish if new release
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo ""
echo "🔍 [3/5] Checking version $TAG on GitHub..."
if git rev-parse "$TAG" >/dev/null 2>&1 || gh release view "$TAG" >/dev/null 2>&1; then
  echo "ℹ Release $TAG is already published on GitHub & npm/PyPI."
else
  echo "🚀 New version detected! Building and publishing $TAG..."
  
  # Build Python packages & upload to PyPI
  echo "  • Building Python wheel & sdist..."
  rm -rf dist build *.egg-info
  python3 setup.py sdist bdist_wheel >/dev/null 2>&1
  
  TWINE_BIN="/Users/mrtag08/Library/Python/3.9/bin/twine"
  if [ -f "$TWINE_BIN" ]; then
    echo "  • Uploading $TAG to PyPI..."
    "$TWINE_BIN" upload dist/* --skip-existing || true
  fi

  # Create GitHub release (triggers GitHub Actions automated npm publish)
  echo "  • Creating GitHub release $TAG (triggers npm publish)..."
  gh release create "$TAG" --title "$TAG" --generate-notes || true

  # Update v1 floating tag
  echo "  • Updating v1 floating tag..."
  git tag -fa v1 -m "Update v1 floating tag to $TAG"
  git push origin v1 --force || true
fi

# 4. Sync Landing Page & Assets to ethiccode.in
ETHICCODE_DIR="/Users/mrtag08/Projects/ethiccode.in"
if [ -d "$ETHICCODE_DIR" ]; then
  echo ""
  echo "🌐 [4/5] Syncing landing page & deploying ethiccode.in..."
  
  # Run deploy.sh in ethiccode.in
  "$ETHICCODE_DIR/deploy.sh" "feat(dotvet): sync v$VERSION updates"
else
  echo "ℹ ethiccode.in repo not found at $ETHICCODE_DIR, skipping site deploy."
fi

# 5. Summary
echo ""
echo "=================================================="
echo "✨ Everything pushed & deployed everywhere!"
echo "  • dotvet GitHub:     https://github.com/EthicCodeTech/dotvet"
echo "  • npm Package:       https://www.npmjs.com/package/dotvet"
echo "  • PyPI Package:      https://pypi.org/project/dotvet/"
echo "  • Live Landing Page: https://ethiccode.in/dotvet/"
echo "=================================================="
