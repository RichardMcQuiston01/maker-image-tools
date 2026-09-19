ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ;

-- OAuth-only accounts (password_hash IS NULL) were already provider-verified
-- at signup, even before this column existed - backfill them as verified
-- rather than leaving pre-migration accounts looking unverified.
UPDATE users SET email_verified_at = created_at WHERE password_hash IS NULL;

CREATE TABLE email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);
