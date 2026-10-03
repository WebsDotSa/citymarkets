# PII Encryption (P0-3)

Application-level AES-256-GCM encryption of PII columns at rest. The
encryption key never leaves process memory; the database stores only
ciphertext and a deterministic blind-index HMAC for lookups.

## Required environment

```bash
# Generate two 32-byte keys, base64-encoded:
node -e "console.log('PII_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('PII_HMAC_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

Both keys must be set in every environment that touches PII (app
servers, the backfill script, anything that runs the encryption
module). The encryption and HMAC keys are independent: a leak of one
does not let an attacker recover the other.

## Threat model

| Threat                                | Mitigated? | Notes                                          |
|---------------------------------------|------------|------------------------------------------------|
| DB breach (stolen credentials, SQLi)   | Yes        | Data is ciphertext. Key not in DB.             |
| DB backup leak                        | Yes        | Backups are encrypted blobs.                   |
| DB read-replica leak                  | Yes        | Same.                                          |
| Process + DB compromise               | No         | Attacker reads plaintext in memory.            |
| Env + DB compromise                   | No         | Attacker derives the DEK and decrypts.          |
| Apple/Google reviewer with DB access  | No         | See process-compromise row.                    |

The follow-up (P0-PII-KMS) replaces the env-derived DEK with
envelope encryption backed by AWS/GCP KMS or HashiCorp Vault
Transit. That closes the env-compromise row.

## How lookups still work after encryption

Encrypted columns are not indexable for equality. We keep a
deterministic HMAC column for lookups:

* `users.phone_hmac` — `WHERE phone_hmac = $1` for OTP login
* `drivers.phone_hmac` — driver lookup
* `users.phone` UNIQUE constraint is replaced by
  `UNIQUE(phone_hmac) WHERE phone_hmac IS NOT NULL`

The HMAC uses a separate key (PII_HMAC_KEY) from the encryption
key. A leak of the HMAC value does not enable decryption.

## Migration and backfill

1. Apply migration `121_pii_encryption_columns.sql`. This adds the
   encrypted + hmac columns and replaces the UNIQUE(phone)
   constraint. No data is moved.
2. Run the backfill script in dry-run mode first to confirm the
   scope:
   ```bash
   tsx scripts/backfill-pii-encryption.ts
   ```
3. Apply the backfill. Batches of 500 rows, 100ms between batches,
   so other queries are not starved:
   ```bash
   tsx scripts/backfill-pii-encryption.ts --apply
   ```
   The script is idempotent: rows that already have an encrypted
   value are skipped, so re-running after a partial backfill is
   safe.
4. After the backfill reports zero rows remaining, the application
   hot paths (`src/app/api/v1/auth/twilio/verify/route.ts` and
   `src/lib/identity/user-repo.ts`) already write the new columns
   on every INSERT.
5. The follow-up work (tracked separately) migrates the remaining
   ~70 query sites that still SELECT the plaintext columns, then
   drops the plaintext columns in a final migration.

## Key rotation

The current implementation supports a single key version per column.
Rotation procedure:

1. Generate a new key pair (PII_ENCRYPTION_KEY_V2, PII_HMAC_KEY_V2).
2. Deploy the new keys alongside the old ones.
3. Re-run the backfill script with the new keys. The script will
   re-encrypt rows that don't match the new key — currently this
   means every row, because the column doesn't store a key version.

The follow-up migration adds a key-version byte prefix to the
ciphertext so the app can decrypt both old and new ciphertexts
during the rotation window. Until that lands, a key rotation
requires a coordinated re-backfill with both keys.
