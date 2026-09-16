import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { COMMUNITY_LIBRARY_URL } from "../lib/communityLibraryUrl";

interface PendingListing {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
}

export function ModerationPanel() {
  const { status: authStatus, user } = useAuth();
  const isModerator = authStatus === "signed-in" && user?.role === "moderator";

  const [listings, setListings] = useState<PendingListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/pending`);
      if (!response.ok) {
        throw new Error(`Community library responded with ${response.status}`);
      }
      const body = (await response.json()) as { listings: PendingListing[] };
      setListings(body.listings);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/community-library dev server running?)`
          : "Failed to load pending listings",
      );
    }
  }, []);

  useEffect(() => {
    if (isModerator) {
      void refreshPending();
    } else {
      setListings([]);
    }
  }, [isModerator, refreshPending]);

  const handleReview = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewerId: user.id }),
        });
        if (!response.ok) {
          throw new Error(`Review failed with ${response.status}`);
        }
        setListings((current) => current.filter((listing) => listing.id !== id));
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/community-library dev server running?)`
            : "Failed to submit review",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  if (!isModerator) {
    return (
      <section className="ai-panel">
        <h2>Moderation Queue</h2>
        <p className="ai-panel__hint">Log in as a moderator to review pending listings.</p>
      </section>
    );
  }

  return (
    <section className="ai-panel">
      <h2>Moderation Queue</h2>
      <p className="ai-panel__hint">Listings awaiting approval, oldest first.</p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      {listings.length === 0 ? (
        <p className="ai-panel__hint">Nothing pending review.</p>
      ) : (
        <ul className="moderation-panel__results">
          {listings.map((listing) => (
            <li key={listing.id}>
              <div className="moderation-panel__listing-info">
                <span className="moderation-panel__listing-title">{listing.title}</span>
                {listing.description && <span>{listing.description}</span>}
                {listing.tags.length > 0 && <span>{listing.tags.join(", ")}</span>}
              </div>
              <div className="ai-panel__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReview(listing.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReview(listing.id, "reject")}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
