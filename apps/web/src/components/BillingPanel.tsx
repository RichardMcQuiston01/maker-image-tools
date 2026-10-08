import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { BILLING_URL } from "../lib/billingUrl";

interface Subscription {
  planTier: string;
  status: string;
  currentPeriodEnd: string | null;
}

/**
 * The paid tiers `@maker/billing` sells (see its `plans.ts`), in ascending
 * order - kept in sync with that map by hand, the same way this panel
 * already duplicates the "pro" tier name rather than importing across
 * services.
 */
const PAID_PLANS: { tier: string; label: string }[] = [
  { tier: "pro", label: "Pro" },
  { tier: "studio", label: "Studio" },
];

export function BillingPanel() {
  const { status: authStatus, user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "signed-in" || !user) {
      setSubscription(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${BILLING_URL}/subscription?userId=${user.id}`);
        if (!response.ok) {
          throw new Error(`Billing service responded with ${response.status}`);
        }
        const body = (await response.json()) as Subscription;
        if (!cancelled) setSubscription(body);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/billing dev server running?)`
            : "Failed to load subscription status",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, user]);

  const handleUpgrade = useCallback(
    async (planTier: string) => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${BILLING_URL}/checkout-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            email: user.email,
            planTier,
            successUrl: window.location.href,
            cancelUrl: window.location.href,
          }),
        });
        if (!response.ok) {
          throw new Error(`Checkout failed with ${response.status}`);
        }
        const { url } = (await response.json()) as { url: string };
        window.location.href = url;
      } catch (err) {
        setBusy(false);
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/billing dev server running?)`
            : "Failed to start checkout",
        );
      }
    },
    [user],
  );

  const handleManage = useCallback(async () => {
    if (!user) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${BILLING_URL}/portal-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, returnUrl: window.location.href }),
      });
      if (!response.ok) {
        throw new Error(`Billing portal request failed with ${response.status}`);
      }
      const { url } = (await response.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/billing dev server running?)`
          : "Failed to open billing portal",
      );
    }
  }, [user]);

  if (authStatus !== "signed-in") {
    return (
      <section className="ai-panel">
        <h2>Billing</h2>
        <p className="ai-panel__hint">Log in to view your plan and manage billing.</p>
      </section>
    );
  }

  const isActivePaidPlan =
    subscription?.status === "active" &&
    PAID_PLANS.some((plan) => plan.tier === subscription.planTier);

  return (
    <section className="ai-panel">
      <h2>Billing</h2>
      <p className="ai-panel__hint">
        {subscription
          ? `Current plan: ${subscription.planTier} (${subscription.status})`
          : "Loading subscription status…"}
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <div className="ai-panel__actions">
        {isActivePaidPlan ? (
          <button type="button" disabled={busy} onClick={() => void handleManage()}>
            {busy ? "Redirecting…" : "Manage Billing"}
          </button>
        ) : (
          PAID_PLANS.map((plan) => (
            <button
              key={plan.tier}
              type="button"
              disabled={busy}
              onClick={() => void handleUpgrade(plan.tier)}
            >
              {busy ? "Redirecting…" : `Upgrade to ${plan.label}`}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
