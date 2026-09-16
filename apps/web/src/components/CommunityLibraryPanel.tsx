import { useCallback, useState } from "react";
import type { VectorDocument } from "@maker/core-vector";
import { useAuth } from "../hooks/useAuth";
import { COMMUNITY_LIBRARY_URL } from "../lib/communityLibraryUrl";

interface ListingSummary {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  ratingAvg: number | null;
  ratingCount: number;
}

interface CommunityLibraryPanelProps {
  document: VectorDocument;
  onLoadDocument: (doc: VectorDocument) => void;
}

export function CommunityLibraryPanel({
  document: vectorDocument,
  onLoadDocument,
}: CommunityLibraryPanelProps) {
  const { status: authStatus, user } = useAuth();

  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"newest" | "rating">("newest");
  const [results, setResults] = useState<ListingSummary[]>([]);
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");
  const [publishStatus, setPublishStatus] = useState<"idle" | "submitting" | "submitted">("idle");

  const handleSearch = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      const params = new URLSearchParams({ sort });
      if (q.trim()) params.set("q", q.trim());
      if (tag.trim()) params.set("tag", tag.trim());

      const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Community library responded with ${response.status}`);
      }
      const body = (await response.json()) as { listings: ListingSummary[] };
      setResults(body.listings);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/community-library dev server running?)`
          : "Failed to search listings",
      );
    } finally {
      setBusy(false);
    }
  }, [q, tag, sort]);

  const handleLoad = useCallback(
    async (id: string) => {
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/${id}`);
        if (!response.ok) {
          throw new Error(`Load failed with ${response.status}`);
        }
        const body = (await response.json()) as { listing: { data: VectorDocument } };
        onLoadDocument(body.listing.data);
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/community-library dev server running?)`
            : "Failed to load listing",
        );
      } finally {
        setBusy(false);
      }
    },
    [onLoadDocument],
  );

  const handleRate = useCallback(
    async (id: string) => {
      if (!user) return;
      const stars = ratingDrafts[id] ?? 5;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/${id}/ratings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, stars }),
        });
        if (!response.ok) {
          throw new Error(`Rating failed with ${response.status}`);
        }
        const body = (await response.json()) as { listing: ListingSummary };
        setResults((current) =>
          current.map((listing) => (listing.id === id ? body.listing : listing)),
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/community-library dev server running?)`
            : "Failed to submit rating",
        );
      } finally {
        setBusy(false);
      }
    },
    [user, ratingDrafts],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings/${id}?userId=${user.id}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Delete failed with ${response.status}`);
        }
        setResults((current) => current.filter((listing) => listing.id !== id));
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/community-library dev server running?)`
            : "Failed to delete listing",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  const handlePublish = useCallback(async () => {
    if (!user || !publishTitle.trim()) return;
    try {
      setPublishStatus("submitting");
      setError(null);
      const tags = publishTags
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const response = await fetch(`${COMMUNITY_LIBRARY_URL}/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          title: publishTitle.trim(),
          description: publishDescription.trim() || undefined,
          tags,
          data: vectorDocument,
        }),
      });
      if (!response.ok) {
        throw new Error(`Publish failed with ${response.status}`);
      }
      setPublishStatus("submitted");
      setPublishTitle("");
      setPublishDescription("");
      setPublishTags("");
    } catch (err) {
      setPublishStatus("idle");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/community-library dev server running?)`
          : "Failed to publish listing",
      );
    }
  }, [user, publishTitle, publishDescription, publishTags, vectorDocument]);

  return (
    <section className="ai-panel">
      <h2>Community Library</h2>
      <p className="ai-panel__hint">
        Browse designs other makers have shared, or publish your own.
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}

      <div className="community-library-panel__search">
        <input
          type="text"
          placeholder="Search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <input
          type="text"
          placeholder="Tag"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as "newest" | "rating")}
        >
          <option value="newest">Newest</option>
          <option value="rating">Top rated</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void handleSearch()}>
          Search
        </button>
      </div>

      {results.length > 0 && (
        <ul className="community-library-panel__results">
          {results.map((listing) => (
            <li key={listing.id}>
              <div className="community-library-panel__listing-info">
                <span className="community-library-panel__listing-title">{listing.title}</span>
                {listing.description && <span>{listing.description}</span>}
                {listing.tags.length > 0 && <span>{listing.tags.join(", ")}</span>}
                <span>
                  {listing.ratingCount > 0
                    ? `${(listing.ratingAvg ?? 0).toFixed(1)}★ (${listing.ratingCount})`
                    : "No ratings yet"}
                </span>
              </div>
              <div className="ai-panel__actions">
                <button type="button" disabled={busy} onClick={() => void handleLoad(listing.id)}>
                  Load
                </button>
                {authStatus === "signed-in" && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={ratingDrafts[listing.id] ?? 5}
                      onChange={(event) =>
                        setRatingDrafts((current) => ({
                          ...current,
                          [listing.id]: Number(event.target.value) || 1,
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRate(listing.id)}
                    >
                      Rate
                    </button>
                  </>
                )}
                {authStatus === "signed-in" && user?.id === listing.userId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDelete(listing.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Publish your design</h3>
      {authStatus !== "signed-in" ? (
        <p className="ai-panel__hint">Log in to publish a design.</p>
      ) : (
        <div className="community-library-panel__publish">
          <input
            type="text"
            placeholder="Title"
            value={publishTitle}
            onChange={(event) => setPublishTitle(event.target.value)}
          />
          <input
            type="text"
            placeholder="Description"
            value={publishDescription}
            onChange={(event) => setPublishDescription(event.target.value)}
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={publishTags}
            onChange={(event) => setPublishTags(event.target.value)}
          />
          <button
            type="button"
            disabled={publishStatus === "submitting" || !publishTitle.trim()}
            onClick={() => void handlePublish()}
          >
            {publishStatus === "submitting" ? "Submitting…" : "Publish for review"}
          </button>
          {publishStatus === "submitted" && (
            <p className="ai-panel__hint">Submitted — awaiting moderation.</p>
          )}
        </div>
      )}
    </section>
  );
}
