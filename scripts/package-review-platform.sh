#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_root="$repo_root/dist/review-platform"
tarball="$repo_root/dist/review-platform.tar.gz"

rm -rf "$package_root" "$tarball"
mkdir -p "$package_root"

cp -R "$repo_root/build" "$package_root/build"
cp -R "$repo_root/dist-cli" "$package_root/dist-cli"
cp "$repo_root/package.json" "$package_root/package.json"
cp "$repo_root/README.md" "$package_root/README.md"
cp "$repo_root/scripts/start-review-platform.sh" "$package_root/start-review-platform.sh"
mkdir -p "$package_root/bin" "$package_root/docs"
cp "$repo_root/bin/review.js" "$repo_root/bin/reviewctl.js" "$repo_root/bin/paste.js" "$repo_root/bin/clipboard.js" "$repo_root/bin/feedback.js" "$repo_root/bin/latest-review.js" "$repo_root/bin/live-snapshot.js" "$package_root/bin/"
cp "$repo_root/docs/live-feedback.md" "$package_root/docs/"
chmod +x "$package_root/start-review-platform.sh" "$package_root/bin/review.js" "$package_root/bin/reviewctl.js" "$package_root/dist-cli/reviewctl.js"

(
	cd "$repo_root/dist"
	tar -czf "$(basename "$tarball")" review-platform
)

printf 'Created %s\n' "$tarball"
