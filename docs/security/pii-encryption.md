# PII Encryption (P0-3 + P0-PII-KMS)

Application-level AES-256-GCM encryption of PII columns at rest, with
**envelope encryption** (Phase 5) so a database breach combined with
an env breach does not let the attacker decrypt the data.

## Why this exists

The original P0-3 audit finding flagged that several columns
(`users.phone`, `users.name`, `users.email`, `drivers.phone`,
`drivers.name`, `addresses.address_text`, `addresses.label`,
`orders.guest_phone`, `orders.guest_name`) were stored in plaintext.
P0-3 added application-level encryption with the key derived from
env vars (`PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`).

P0-PII-KMS (Phase 5, 2026-10-03) closes the "env + DB compromise"
threat by switching to **envelope encryption**: the actual data
encryption key (DEK) is itself wrapped by a master key (KEK) using
AES-256-KW (RFC 3394). The KEK lives in env; the wrapped DEK lives
in a `pii_keys` table (and optionally in env as `PII_DATA_KEY` for
boot-time use). An attacker who reads both the DB and the env must
also call the unwrap function — which is a single line in this
module. When we later swap that unwrap call for a remote KMS
`Decrypt` API, the threat improves without changing any application
code.

## Required environment

```bash
# 1. Generate the master key (KEK) — 32 random bytes, base64.
PII_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# 2. Generate a wrapped DEK and seed the pii_keys table.
PII_MASTER_KEY=$PII_MASTER_KEY npx tsx scripts/generate-pii-dek.ts
#    → prints the wrapped DEK, the KEK fingerprint, and a SQL INSERT.

# 3. Set PII_DATA_KEY in env (the wrapped DEK from step 2). This
#    lets the app boot before the DB is reachable (e.g. for the
#    backfill script).
PII_DATA_KEY=<base64-from-step-2>
```

The legacy env vars remain in play during the transition period so
rows encrypted by P0-3 still decrypt:

```bash
PII_ENCRYPTION_KEY=<32-byte-base64>     # legacy DEK source
PII_HMAC_KEY=<32-byte-base64>           # legacy HMAC key source
```

Once the backfill reports zero legacy rows remaining, drop the
legacy env vars. The application refuses to read legacy ciphertext
without them, which is the operator's signal that the cutover is
complete.

## Threat model

| Threat                                | P0-3   | P0-PII-KMS (this)  | Future KMS upgrade   |
|---------------------------------------|--------|--------------------|----------------------|
| DB breach (stolen credentials, SQLi)   | Yes    | Yes                | Yes                  |
| DB backup leak                        | Yes    | Yes                | Yes                  |
| DB read-replica leak                  | Yes    | Yes                | Yes                  |
| Process + DB compromise               | No     | No                 | No                   |
| Env + DB compromise                   | No     | Mostly — attacker  | Yes                  |
|                                       |        | also needs the     |                      |
|                                       |        | unwrap function    |                      |

For the "env + DB compromise" row: with envelope encryption, the
attacker now needs the unwrap function (one line of code in
`src/lib/security/pii-crypto.ts`). When the unwrap function becomes
a remote call to AWS KMS / GCP KMS / Vault Transit, an attacker
without credentials for that service cannot decrypt. The crypto
code in this module does not need to change to make that swap.

## Algorithm

- **Cell encryption**: AES-256-GCM, 96-bit random IV, 128-bit auth
  tag appended to ciphertext.
- **Key encryption (envelope)**: AES-256-KW (RFC 3394) with the
  KEK (`PII_MASTER_KEY`). The DEK is 32 random bytes, generated
  once per deployment by `scripts/generate-pii-dek.ts`. The wrapped
  DEK is stored in the `pii_keys` table and mirrored to
  `PII_DATA_KEY` in env so the app can boot before the DB.
- **Blind index HMAC**: HMAC-SHA256 of the normalised plaintext,
  with a 32-byte key derived from the active DEK via HKDF-SHA256.
  Legacy rows whose hmac column was written by P0-3 still match
  because the legacy HMAC key (`PII_HMAC_KEY`) is read alongside
  the new key — use `piiHmacLegacy` for the legacy path.

## Ciphertext format (base64-encoded)

**Envelope (Phase 5, written by every new `encryptPii` call):**

```
0x01 || wrapped_dek_version(1) || iv(12) || ciphertext || tag(16)
```

The first byte (`0x01`) selects the envelope scheme. The second
byte references a row in `pii_keys`; for now it is always `0x01`.
The IV is 12 bytes, the GCM tag is 16 bytes.

**Legacy (P0-3, still readable):**

```
iv(12) || ciphertext || tag(16)
```

The decoder detects legacy by checking the first byte: anything
other than `0x01` is treated as legacy. (There is a theoretical 1/256
chance of a false match where a random legacy IV byte happens to be
`0x01`; the GCM auth tag rejects it cleanly.)

## Operator setup

1. Apply migration `121_pii_encryption_columns.sql` (already applied
   in P0-3) if not already on the DB. Adds the `*_encrypted` and
   `*_hmac` columns, replaces the `UNIQUE(phone)` constraint with a
   `UNIQUE(phone_hmac)` partial index.
2. Apply migration `123_pii_envelope_keys.sql`. Creates the
   `pii_keys` table for storing wrapped DEKs.
3. Generate the master key (KEK) and the wrapped DEK using
   `scripts/generate-pii-dek.ts`. Run the printed SQL against the
   DB. Set `PII_MASTER_KEY` and `PII_DATA_KEY` in every environment
   that touches PII.
4. Run `scripts/backfill-pii-encryption.ts --apply` to write
   envelope-format ciphertext and the active HMAC for any rows
   whose `*_encrypted` column is still NULL. Rows already encrypted
   by P0-3 are skipped by this script — they remain readable via
   the legacy path.
5. After the backfill reports zero rows remaining, run the
   follow-up "re-encrypt legacy" migration (Phase 6) which
   flips the whereSql to pick up rows still in legacy format.
6. After step 5, drop `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` from
   env. The application refuses to read legacy ciphertext without
   them.

## Key rotation

1. Generate a new KEK: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Generate a new wrapped DEK with the new KEK using
   `PII_MASTER_KEY=$NEW_KEK npx tsx scripts/generate-pii-dek.ts`.
   Increment the printed `key_version` to `2`. Insert the row with
   `is_active = true` and set the previous row's `is_active` to
   false (the table's `pii_keys_one_active` constraint enforces
   exactly one active row).
3. Deploy the new env (`PII_MASTER_KEY`, `PII_DATA_KEY`). The new
   `encryptPii` writes ciphertext tagged with `key_version=2`.
   The `decryptPii` read path looks up the DEK by version — both
   old (version 1) and new (version 2) ciphertexts decrypt.
4. Re-run the backfill. Rows whose ciphertext key version is below
   the new version are re-encrypted under the new DEK. The legacy
   `PII_ENCRYPTION_KEY` / `PII_HMAC_KEY` env vars can stay for as
   long as legacy rows exist.

## Upgrade path to a real KMS

The crypto in `src/lib/security/pii-crypto.ts` does not change when
the KEK moves into a KMS. The only line that changes is the body of
`unwrapDek`:

```diff
- function unwrapDek(wrappedDekB64: string, kek: Buffer): Buffer {
-   return aesKeyUnwrap(kek, Buffer.from(wrappedDekB64, "base64"));
- }
+ async function unwrapDek(wrappedDekB64: string): Promise<Buffer> {
+   return await kmsClient.decrypt({
+     CiphertextBlob: Buffer.from(wrappedDekB64, "base64"),
+   }).then(r => r.Plaintext);
+ }
```

The caller (`loadActiveDek`) becomes async. The `encryptPii`,
`decryptPii`, `piiHmac` API does not change. An attacker who reads
the DB no longer recovers the DEK with the env — they also need
AWS credentials authorised to call `kms:Decrypt`.

Suggested providers in priority order:
1. AWS KMS with envelope encryption + alias rotation.
2. GCP KMS with the same scheme.
3. HashiCorp Vault Transit (`transit/decrypt`).
4. Self-hosted HSM (YubiHSM 2, etc.) for air-gapped deployments.

For each, the row schema (`pii_keys`) already accommodates the
migration — `wrapped_dek` is the ciphertext blob, `key_version` is
the alias version, `kek_fingerprint` is for verification.

## Backward compatibility

The legacy P0-3 format is decoded by `decryptPii` when the first
byte is not `0x01`. The legacy HMAC key path is reachable via
`piiHmacLegacy`. Both are guarded: if the legacy env var is
absent, the call throws, surfacing "you read a legacy row but you
don't have the key" as a clear error rather than a silent failure.