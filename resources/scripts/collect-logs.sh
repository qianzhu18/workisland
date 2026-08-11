#!/bin/bash
set -euo pipefail

output_dir="$(pwd)"
while getopts ":o:" option; do
  case "$option" in
    o) output_dir="$OPTARG" ;;
    *) echo "Usage: collect-logs.sh -o OUTPUT_DIR" >&2; exit 2 ;;
  esac
done

mkdir -p "$output_dir"
timestamp="$(date +%Y%m%d-%H%M%S)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/orca-logs.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

if [ -d "$HOME/Library/Logs/Orca" ]; then
  cp -R "$HOME/Library/Logs/Orca" "$work_dir/application-logs"
fi
if [ -d "$HOME/.flux/logs" ]; then
  mkdir -p "$work_dir/hook-logs"
  find "$HOME/.flux/logs" -maxdepth 1 -type f -name '*.log' -exec cp {} "$work_dir/hook-logs/" \;
fi

archive="$output_dir/orca-diagnostics-$timestamp.zip"
ditto -c -k --sequesterRsrc --keepParent "$work_dir" "$archive"
echo "输出文件: $archive"
