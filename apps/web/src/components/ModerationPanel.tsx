import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";
import { COMMUNITY_LIBRARY_URL } from "../lib/communityLibraryUrl";
import { MATERIAL_DB_URL } from "../lib/materialDbUrl";

interface PendingListing {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
}

interface PendingPreset {
  id: string;
  material: string;
  machineType: string;
  operation: string;
  speed: number;
  power: number;
  notes: string | null;
}

export function ModerationPanel() {
  const { status: authStatus, user, token } = useAuth();
  const isModerator = authStatus === "signed-in" && user?.role === "moderator";

  const [listings, setListings] = useState<PendingListing[]>([]);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [presets, setPresets] = useState<PendingPreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [targetUserId, setTargetUserId] = useState("");
  const [roleActionBusy, setRoleActionBusy] = useState(false);
  const [roleActionError, setRoleActionError] = useState<string | null>(null);
  const [roleActionResult, setRoleActionResult] = useState<string | null>(null);

  const refreshListings = useCallback(async () => {
    try {
      setListingsError(null);
      const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/pending`);
      if (!response.ok) {
        throw new Error(`Community library responded with ${response.status}`);
      }
      const body = (await response.json()) as { listings: PendingListing[] };
      setListings(body.listings);
    } catch (err) {
      setListingsError(
        err instanceof Error
          ? `${err.message} (is the @maker/community-library dev server running?)`
          : "Failed to load pending listings",
      );
    }
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      setPresetsError(null);
      const response = await fetch(`${MATERIAL_DB_URL}/presets/pending`);
      if (!response.ok) {
        throw new Error(`Material database responded with ${response.status}`);
      }
      const body = (await response.json()) as { presets: PendingPreset[] };
      setPresets(body.presets);
    } catch (err) {
      setPresetsError(
        err instanceof Error
          ? `${err.message} (is the @maker/material-db dev server running?)`
          : "Failed to load pending presets",
      );
    }
  }, []);

  useEffect(() => {
    if (isModerator) {
      void refreshListings();
      void refreshPresets();
    } else {
      setListings([]);
      setPresets([]);
    }
  }, [isModerator, refreshListings, refreshPresets]);

  const handleReviewListing = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (!user) return;
      try {
        setBusy(true);
        setListingsError(null);
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
        setListingsError(
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

  const handleReviewPreset = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (!user) return;
      try {
        setBusy(true);
        setPresetsError(null);
        const response = await fetch(`${MATERIAL_DB_URL}/presets/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewerId: user.id }),
        });
        if (!response.ok) {
          throw new Error(`Review failed with ${response.status}`);
        }
        setPresets((current) => current.filter((preset) => preset.id !== id));
      } catch (err) {
        setPresetsError(
          err instanceof Error
            ? `${err.message} (is the @maker/material-db dev server running?)`
            : "Failed to submit review",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  const handleSetRole = useCallback(
    async (role: "moderator" | "user") => {
      if (!token || !targetUserId.trim()) return;
      try {
        setRoleActionBusy(true);
        setRoleActionError(null);
        setRoleActionResult(null);
        const response = await fetch(`${ACCOUNTS_URL}/users/${targetUserId.trim()}/role`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ role }),
        });
        if (!response.ok) {
          throw new Error(`Role update failed with ${response.status}`);
        }
        const body = (await response.json()) as { user: { id: string; role: string } };
        setRoleActionResult(`${body.user.id} is now "${body.user.role}".`);
      } catch (err) {
        setRoleActionError(
          err instanceof Error
            ? `${err.message} (is the @maker/accounts dev server running?)`
            : "Failed to update role",
        );
      } finally {
        setRoleActionBusy(false);
      }
    },
    [token, targetUserId],
  );

  if (!isModerator) {
    return (
      <section className="ai-panel">
        <h2>Moderation Queue</h2>
        <p className="ai-panel__hint">Log in as a moderator to review pending submissions.</p>
      </section>
    );
  }

  return (
    <section className="ai-panel">
      <h2>Moderation Queue</h2>
      <p className="ai-panel__hint">Submissions awaiting approval, oldest first.</p>

      <h3>Moderator Access</h3>
      <p className="ai-panel__hint">
        Grant or revoke moderator access for another user by their account id.
      </p>
      {roleActionError && (
        <p role="alert" className="ai-panel__error">
          {roleActionError}
        </p>
      )}
      {roleActionResult && <p className="ai-panel__result">{roleActionResult}</p>}
      <input
        type="text"
        placeholder="User ID"
        value={targetUserId}
        onChange={(event) => setTargetUserId(event.target.value)}
      />
      <div className="ai-panel__actions">
        <button
          type="button"
          disabled={roleActionBusy || !targetUserId.trim()}
          onClick={() => void handleSetRole("moderator")}
        >
          Grant moderator
        </button>
        <button
          type="button"
          disabled={roleActionBusy || !targetUserId.trim()}
          onClick={() => void handleSetRole("user")}
        >
          Revoke moderator
        </button>
      </div>

      <h3>Community Library</h3>
      {listingsError && (
        <p role="alert" className="ai-panel__error">
          {listingsError}
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
                  onClick={() => void handleReviewListing(listing.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReviewListing(listing.id, "reject")}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Material Presets</h3>
      {presetsError && (
        <p role="alert" className="ai-panel__error">
          {presetsError}
        </p>
      )}
      {presets.length === 0 ? (
        <p className="ai-panel__hint">Nothing pending review.</p>
      ) : (
        <ul className="moderation-panel__results">
          {presets.map((preset) => (
            <li key={preset.id}>
              <div className="moderation-panel__listing-info">
                <span className="moderation-panel__listing-title">
                  {preset.material} — {preset.machineType} — {preset.operation}
                </span>
                <span>
                  speed {preset.speed}, power {preset.power}
                </span>
                {preset.notes && <span>{preset.notes}</span>}
              </div>
              <div className="ai-panel__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReviewPreset(preset.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReviewPreset(preset.id, "reject")}
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
