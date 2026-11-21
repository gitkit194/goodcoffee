#!/usr/bin/env bash
# Creates the throwaway TLS certificates for tests/pinned.deno.ts (npm run test:deno): a test CA and a
# certificate for the made-up name "shop.test", signed by it. Written to tests/fixtures/, which git
# ignores, and created fresh for every run, so no key ever lives in the repository.
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 -subj '/CN=GoodCoffee Test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$TMP/ca.key" -out test-ca.crt 2>/dev/null

openssl req -newkey rsa:2048 -nodes -sha256 -subj '/CN=shop.test' -keyout shop.test.key -out "$TMP/shop.csr" 2>/dev/null
printf 'subjectAltName=DNS:shop.test\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > "$TMP/ext"
openssl x509 -req -sha256 -days 2 -in "$TMP/shop.csr" -CA test-ca.crt -CAkey "$TMP/ca.key" -set_serial "0x$(openssl rand -hex 8)" \
  -extfile "$TMP/ext" -out shop.test.crt 2>/dev/null
