#!/usr/bin/env bash
# Сборка всего: фронт (vite, single-file) → gzip → go-лаунчер (linux + windows exe)
set -euo pipefail
cd "$(dirname "$0")"

(cd app && npm ci && npx vite build)

gzip -c -9 app/dist/index.html > launcher/app.html.gz

(cd launcher && go build -ldflags="-s -w" -o instron-lab .)
(cd launcher && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o instron-lab.exe .)

echo "Готово: launcher/instron-lab, launcher/instron-lab.exe"
