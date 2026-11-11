#!/usr/bin/env bash
# Playwright and Chromium for the e2e and smoke tests (CI only: Playwright is not a project dependency).
# Chromium's system packages come from the Ubuntu archive, which runners sometimes can't reach: try three times, then
# install Chromium without them. GitHub's Ubuntu images carry most of what headless Chromium needs, and the tests that
# follow fail plainly if something is missing.
set -u
npm install --no-save playwright || exit 1
for attempt in 1 2 3; do
  if npx playwright install --with-deps chromium; then exit 0; fi
  echo "::warning::installing Chromium's system packages failed (attempt $attempt of 3)"
  sleep $((attempt * 15))
done
echo "::warning::installing Chromium without its system packages: the Ubuntu archive could not be reached"
npx playwright install chromium
