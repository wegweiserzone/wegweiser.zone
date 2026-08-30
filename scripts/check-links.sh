#!/usr/bin/env bash
# Checks that every internal link in the built site points at a file that exists.
set -uo pipefail

root="${1:-httpdocs}"
[ -d "$root" ] || { echo "no such directory: $root" >&2; exit 2; }

# Quotes are optional: the build is minified.
found=0
missing=0
while IFS= read -r hit; do
  page="${hit%%:*}"
  link="${hit#*:href=}"
  link="${link#\"}"
  found=$((found + 1))

  target="$root$link"
  if [ -f "$target" ] || [ -f "${target%/}/index.html" ]; then
    continue
  fi
  printf '  %-34s -> %s\n' "${page#"$root"/}" "$link" >&2
  missing=$((missing + 1))
done < <(grep -roE 'href="?/[^"#?> ]*' "$root" --include='*.html')

if [ "$missing" -gt 0 ]; then
  echo "$missing of $found internal links are broken" >&2
  exit 1
fi
echo "every internal link resolves ($found checked)"
