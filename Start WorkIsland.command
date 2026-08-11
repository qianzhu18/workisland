#!/bin/zsh
set -eu

SOURCE_DIR="${0:A:h}"
cd "$SOURCE_DIR"
exec npm run dev
