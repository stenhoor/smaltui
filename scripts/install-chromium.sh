#!/usr/bin/env bash
# Playwright and Chromium for the e2e and smoke tests (CI only: Playwright is not a project dependency).
# Chromium's system packages come from the Ubuntu archive, which runners sometimes can't reach. Short apt timeouts make
# an unreachable archive fail in seconds rather than minutes; then Chromium is installed without the system packages.
# GitHub's Ubuntu images carry most of what headless Chromium needs, and the tests that follow fail plainly if
# something is missing.
set -u
npm install --no-save playwright || exit 1
if command -v sudo >/dev/null && [ -d /etc/apt/apt.conf.d ]; then
  printf 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n' | sudo tee /etc/apt/apt.conf.d/99-smaltui-timeouts >/dev/null
fi
if npx playwright install --with-deps chromium; then exit 0; fi
echo "::warning::installing Chromium without its system packages: the Ubuntu archive could not be reached"
npx playwright install chromium
