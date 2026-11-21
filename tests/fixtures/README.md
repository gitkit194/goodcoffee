# Test fixtures

`npm run test:deno` first runs [`scripts/make-test-certs.sh`](../../scripts/make-test-certs.sh), which creates
`test-ca.crt`, `shop.test.crt` and `shop.test.key` here: a throwaway test CA and a certificate for the
made-up name `shop.test`, which `tests/pinned.deno.ts` serves from 127.0.0.1. They are recreated for
every run, valid for two days and ignored by git. Never put a real key here.
