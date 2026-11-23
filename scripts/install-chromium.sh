#!/usr/bin/env bash
# Playwright and Chromium for the e2e and smoke tests (CI only: Playwright is not a project dependency).
# Chromium's system packages come from the Ubuntu archive, which runners sometimes can't reach. Short apt timeouts make
# an unreachable archive fail in seconds rather than minutes; then Chromium is installed without the system packages.
# GitHub's Ubuntu images carry most of what headless Chromium needs, and the tests that follow fail plainly if
# something is missing.
#
# Playwright goes in a folder of its own, .cache/playwright, not in node_modules: an `npm install --no-save` in the
# project resets node_modules to the lockfile, and `npm run deps` (the pinned smaltdb packages) and Playwright would
# each remove the other. The tests find it through NODE_PATH, which this script exports to later CI steps.
set -u
pw="$(pwd)/.cache/playwright"
npm install --prefix "$pw" --no-audit --no-fund --no-save --no-package-lock playwright || exit 1
export NODE_PATH="$pw/node_modules${NODE_PATH:+:$NODE_PATH}"
[ -n "${GITHUB_ENV:-}" ] && echo "NODE_PATH=$NODE_PATH" >> "$GITHUB_ENV"
playwright="$pw/node_modules/.bin/playwright"
if command -v sudo >/dev/null && [ -d /etc/apt/apt.conf.d ]; then
  printf 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n' | sudo tee /etc/apt/apt.conf.d/99-smaltui-timeouts >/dev/null
fi
if "$playwright" install --with-deps chromium; then exit 0; fi
echo "::warning::installing Chromium without its system packages: the Ubuntu archive could not be reached"
"$playwright" install chromium
