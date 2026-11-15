#!/usr/bin/env bash
# Gera hostops-ai.zip com o código-fonte, sem node_modules, builds, credenciais ou temporários.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT_NAME="hostops-ai"
OUT="${1:-$PWD/hostops-ai.zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$ROOT_NAME"
tar -cf - \
  --exclude='./node_modules' --exclude='*/node_modules' \
  --exclude='.next' --exclude='dist' --exclude='out' --exclude='coverage' \
  --exclude='./.env' --exclude='.env.local' --exclude='.env.*.local' \
  --exclude='./database/src/generated' \
  --exclude='./storage' --exclude='*.log' --exclude='dump.rdb' --exclude='*.tsbuildinfo' \
  --exclude='.DS_Store' --exclude='./.git' --exclude='./hostops-ai.zip' \
  . | tar -xf - -C "$STAGE/$ROOT_NAME"

# Trava de segurança: nunca empacotar um .env real.
if find "$STAGE" -name '.env' -o -name '.env.local' | grep -q .; then
  echo "ERRO: arquivo .env encontrado no pacote." >&2
  exit 1
fi

rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" "$ROOT_NAME")
echo "Pacote gerado: $OUT ($(du -h "$OUT" | cut -f1), $(unzip -Z1 "$OUT" | grep -vc '/$') arquivos)"
