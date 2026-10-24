#!/bin/sh
# Vercel's ignoreCommand (run from site/): exit 0 skips the build, 1 builds. Lives here because vercel.json caps the
# command at 256 characters. Builds when there's no last deploy to compare with, or its commit is missing from the
# shallow clone, or anything the site reads changed since it.
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] &&
  git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null &&
  git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ../packages ../skill ../package.json ../tsconfig.base.json ../bun.lock; then
  exit 0
fi
exit 1
