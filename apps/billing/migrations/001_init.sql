-- No foreign key to apps/accounts's `users` table: that table lives in a
-- separate database owned by a separate service. `user_id` here is just the
-- accounts service's user UUID, carried opaquely.

CREATE TABLE customers (
  user_id UUID PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES customers (user_id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan_tier TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);

CREATE TABLE usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX usage_events_user_metric_created_idx ON usage_events (user_id, metric, created_at);
