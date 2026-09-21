import { useCallback, useEffect, useState } from "react";
import type { VectorDocument } from "@maker/core-vector";
import { useAuth } from "../hooks/useAuth";
import { CLOUD_PROJECTS_URL } from "../lib/cloudProjectsUrl";
import { COMMUNITY_LIBRARY_URL } from "../lib/communityLibraryUrl";
import { renderThumbnail } from "../lib/renderThumbnail";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
}

/**
 * Fetches a project's thumbnail with the caller's bearer token (an <img
 * src> can't carry an Authorization header) and shows it as an object URL,
 * revoked on cleanup. Renders nothing while loading or if the fetch fails -
 * a missing thumbnail just falls back to the plain text list item.
 */
function ProjectThumbnail({
  projectId,
  projectName,
  token,
}: {
  projectId: string;
  projectName: string;
  token: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${projectId}/thumbnail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        // Best-effort - a missing/failed thumbnail just falls back to no image.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, token]);

  if (!url) return null;
  return (
    <img
      className="cloud-projects-panel__thumbnail"
      src={url}
      alt={`Thumbnail for ${projectName}`}
    />
  );
}

/** Reads a failed fetch response's `{ error }` body, falling back to a generic message with its status if the body isn't JSON. */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Body wasn't JSON - fall through to the generic message below.
  }
  return `${fallback} with ${response.status}`;
}

interface CloudProjectsPanelProps {
  document: VectorDocument;
  onLoadDocument: (doc: VectorDocument) => void;
  /** The traced image's pixel dimensions - the coordinate space vectorDocument's paths are in - used to rasterize a thumbnail on save. Defaults to 400x400 when there's no source image yet, matching VectorPreview's own fallback. */
  sourceWidth?: number | undefined;
  sourceHeight?: number | undefined;
}

export function CloudProjectsPanel({
  document: vectorDocument,
  onLoadDocument,
  sourceWidth = 400,
  sourceHeight = 400,
}: CloudProjectsPanelProps) {
  const { status: authStatus, user, token } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<{ projectId: string; token: string } | null>(null);
  const [publishOpenFor, setPublishOpenFor] = useState<string | null>(null);
  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");
  const [publishStatus, setPublishStatus] = useState<"idle" | "submitting" | "submitted">("idle");

  const refreshProjects = useCallback(async (sessionToken: string) => {
    try {
      const response = await fetch(`${CLOUD_PROJECTS_URL}/projects`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        throw new Error(`Cloud projects service responded with ${response.status}`);
      }
      const body = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(body.projects);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/cloud-projects dev server running?)`
          : "Failed to load projects",
      );
    }
  }, []);

  useEffect(() => {
    if (authStatus === "signed-in" && token) {
      void refreshProjects(token);
    } else {
      setProjects([]);
    }
  }, [authStatus, token, refreshProjects]);

  const handleSave = useCallback(async () => {
    if (!token || !name.trim()) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${CLOUD_PROJECTS_URL}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), data: vectorDocument }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "Save failed"));
        return;
      }
      const { project } = (await response.json()) as { project: { id: string } };
      try {
        const thumbnail = await renderThumbnail(vectorDocument, sourceWidth, sourceHeight);
        if (thumbnail) {
          await fetch(`${CLOUD_PROJECTS_URL}/projects/${project.id}/thumbnail`, {
            method: "PUT",
            headers: { "Content-Type": "image/png", Authorization: `Bearer ${token}` },
            body: thumbnail,
          });
        }
      } catch {
        // Best-effort - a thumbnail failure shouldn't block a successful save.
      }
      setName("");
      await refreshProjects(token);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/cloud-projects dev server running?)`
          : "Failed to save project",
      );
    } finally {
      setBusy(false);
    }
  }, [token, name, vectorDocument, sourceWidth, sourceHeight, refreshProjects]);

  const handleLoad = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Load failed with ${response.status}`);
        }
        const body = (await response.json()) as { project: { data: VectorDocument } };
        onLoadDocument(body.project.data);
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to load project",
        );
      } finally {
        setBusy(false);
      }
    },
    [token, onLoadDocument],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Delete failed with ${response.status}`);
        }
        await refreshProjects(token);
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to delete project",
        );
      } finally {
        setBusy(false);
      }
    },
    [token, refreshProjects],
  );

  const handleShare = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}/share`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Share failed with ${response.status}`);
        }
        const { token: shareToken } = (await response.json()) as { token: string };
        setShareInfo({ projectId: id, token: shareToken });
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to create share link",
        );
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  const handleRevokeShare = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}/share`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Revoke failed with ${response.status}`);
        }
        setShareInfo((current) => (current?.projectId === id ? null : current));
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to revoke share link",
        );
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  const handleOpenPublish = useCallback((project: ProjectSummary) => {
    setPublishOpenFor(project.id);
    setPublishTitle(project.name);
    setPublishDescription("");
    setPublishTags("");
    setPublishStatus("idle");
  }, []);

  const handlePublish = useCallback(
    async (id: string) => {
      if (!user || !token || !publishTitle.trim()) return;
      try {
        setPublishStatus("submitting");
        setError(null);
        const projectResponse = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!projectResponse.ok) {
          throw new Error(`Load failed with ${projectResponse.status}`);
        }
        const projectBody = (await projectResponse.json()) as { project: { data: VectorDocument } };
        const tags = publishTags
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        const listingResponse = await fetch(`${COMMUNITY_LIBRARY_URL}/listings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            title: publishTitle.trim(),
            description: publishDescription.trim() || undefined,
            tags,
            data: projectBody.project.data,
          }),
        });
        if (!listingResponse.ok) {
          throw new Error(`Publish failed with ${listingResponse.status}`);
        }
        setPublishStatus("submitted");
      } catch (err) {
        setPublishStatus("idle");
        setError(
          err instanceof Error
            ? `${err.message} (are the @maker/cloud-projects and @maker/community-library dev servers running?)`
            : "Failed to publish project",
        );
      }
    },
    [user, token, publishTitle, publishDescription, publishTags],
  );

  if (authStatus !== "signed-in") {
    return (
      <section className="ai-panel">
        <h2>Cloud Projects</h2>
        <p className="ai-panel__hint">Log in to save and load projects across devices.</p>
      </section>
    );
  }

  return (
    <section className="ai-panel">
      <h2>Cloud Projects</h2>
      <p className="ai-panel__hint">Save this design or load a previously saved one.</p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <div className="ai-panel__actions">
        <input
          type="text"
          placeholder="Project name"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void handleSave()}>
          Save
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="ai-panel__hint">No saved projects yet.</p>
      ) : (
        <ul className="cloud-projects-panel__list">
          {projects.map((project) => (
            <li key={project.id}>
              {project.hasThumbnail && token && (
                <ProjectThumbnail projectId={project.id} projectName={project.name} token={token} />
              )}
              <span>{project.name}</span>
              <div className="ai-panel__actions">
                <button type="button" disabled={busy} onClick={() => void handleLoad(project.id)}>
                  Load
                </button>
                <button type="button" disabled={busy} onClick={() => void handleShare(project.id)}>
                  Share
                </button>
                <button type="button" disabled={busy} onClick={() => void handleDelete(project.id)}>
                  Delete
                </button>
                <button type="button" disabled={busy} onClick={() => handleOpenPublish(project)}>
                  Publish to Library
                </button>
              </div>
              {publishOpenFor === project.id &&
                (publishStatus === "submitted" ? (
                  <p className="ai-panel__hint">
                    Submitted to the community library — awaiting moderation.
                  </p>
                ) : (
                  <div className="cloud-projects-panel__publish">
                    <input
                      type="text"
                      placeholder="Title"
                      value={publishTitle}
                      disabled={publishStatus === "submitting"}
                      onChange={(event) => setPublishTitle(event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={publishDescription}
                      disabled={publishStatus === "submitting"}
                      onChange={(event) => setPublishDescription(event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Tags (comma separated)"
                      value={publishTags}
                      disabled={publishStatus === "submitting"}
                      onChange={(event) => setPublishTags(event.target.value)}
                    />
                    <div className="ai-panel__actions">
                      <button
                        type="button"
                        disabled={publishStatus === "submitting" || !publishTitle.trim()}
                        onClick={() => void handlePublish(project.id)}
                      >
                        {publishStatus === "submitting" ? "Publishing…" : "Publish"}
                      </button>
                      <button type="button" onClick={() => setPublishOpenFor(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              {shareInfo?.projectId === project.id && (
                <p className="ai-panel__hint">
                  Share link:{" "}
                  <a
                    href={`#/shared/${shareInfo.token}`}
                  >{`${window.location.origin}${window.location.pathname}#/shared/${shareInfo.token}`}</a>
                  {" — "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRevokeShare(project.id)}
                  >
                    Revoke
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
