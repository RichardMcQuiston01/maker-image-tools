import { useCallback, useEffect, useRef, useState } from "react";
import type { VectorDocument } from "@maker/core-vector";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";
import { CLOUD_PROJECTS_URL } from "../lib/cloudProjectsUrl";
import { COMMUNITY_LIBRARY_URL } from "../lib/communityLibraryUrl";
import { renderThumbnail } from "../lib/renderThumbnail";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
  /** The signed-in user's relationship to this project. Determines whether Delete/Share/collaborator
   * management are shown - only the owner gets those, a collaborator only gets Load and (read-only)
   * the collaborator list. */
  role?: "owner" | "collaborator";
}

interface Collaborator {
  userId: string;
  addedAt: string;
}

type LiveEvent =
  | { type: "project"; project: { data: VectorDocument } }
  | { type: "deleted" }
  | { type: "collaborators"; collaborators: Collaborator[] };

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

  const [openCollaboratorsFor, setOpenCollaboratorsFor] = useState<string | null>(null);
  const [collaboratorsByProject, setCollaboratorsByProject] = useState<
    Record<string, Collaborator[]>
  >({});
  const [collaboratorEmailInput, setCollaboratorEmailInput] = useState<Record<string, string>>({});
  const [collaboratorBusy, setCollaboratorBusy] = useState(false);

  // Which project (if any) is currently loaded into the editor - drives the
  // "someone else changed this" live banner below, which only makes sense
  // for the project actually open right now.
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<"updated" | "deleted" | null>(null);

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
        setLoadedProjectId(id);
        setLiveNotice(null);
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

  // Subscribes to live updates for whichever project is currently loaded in
  // the editor, so a collaborator's save elsewhere surfaces as a banner
  // instead of silently going stale. Doesn't touch the open editor's
  // content itself - reloading is the user's call (see handleReloadLive).
  const isFirstLiveMessage = useRef(true);
  useEffect(() => {
    if (!loadedProjectId || !token) return;
    isFirstLiveMessage.current = true;
    const source = new EventSource(
      `${CLOUD_PROJECTS_URL}/projects/${loadedProjectId}/live?token=${encodeURIComponent(token)}`,
    );
    source.onmessage = (event) => {
      // The stream's first message is just this project's current state,
      // sent immediately on connect - not a change to react to.
      if (isFirstLiveMessage.current) {
        isFirstLiveMessage.current = false;
        return;
      }
      const parsed = JSON.parse(event.data) as LiveEvent;
      if (parsed.type === "project") {
        setLiveNotice("updated");
      } else if (parsed.type === "deleted") {
        setLiveNotice("deleted");
      } else if (parsed.type === "collaborators") {
        setCollaboratorsByProject((current) => ({
          ...current,
          [loadedProjectId]: parsed.collaborators,
        }));
      }
    };
    return () => source.close();
  }, [loadedProjectId, token]);

  const handleReloadLive = useCallback(() => {
    if (!loadedProjectId) return;
    setLiveNotice(null);
    void handleLoad(loadedProjectId);
  }, [loadedProjectId, handleLoad]);

  const handleDismissLiveNotice = useCallback(() => setLiveNotice(null), []);

  const handleToggleCollaborators = useCallback(
    async (id: string) => {
      const opening = openCollaboratorsFor !== id;
      setOpenCollaboratorsFor(opening ? id : null);
      if (!opening || !token || collaboratorsByProject[id]) return;
      try {
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}/collaborators`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { collaborators: Collaborator[] };
        setCollaboratorsByProject((current) => ({ ...current, [id]: body.collaborators }));
      } catch {
        // Best-effort - the panel just stays empty/loading if this fails.
      }
    },
    [openCollaboratorsFor, token, collaboratorsByProject],
  );

  const handleAddCollaborator = useCallback(
    async (id: string) => {
      const email = collaboratorEmailInput[id]?.trim();
      if (!token || !email) return;
      try {
        setCollaboratorBusy(true);
        setError(null);
        const lookup = await fetch(
          `${ACCOUNTS_URL}/users/by-email?email=${encodeURIComponent(email)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!lookup.ok) {
          setError(
            lookup.status === 404
              ? `No account with email "${email}"`
              : await readErrorMessage(lookup, "Couldn't look up that email"),
          );
          return;
        }
        const { id: collaboratorUserId } = (await lookup.json()) as { id: string };
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}/collaborators`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId: collaboratorUserId }),
        });
        if (!response.ok) {
          setError(await readErrorMessage(response, "Couldn't add collaborator"));
          return;
        }
        const body = (await response.json()) as { collaborators: Collaborator[] };
        setCollaboratorsByProject((current) => ({ ...current, [id]: body.collaborators }));
        setCollaboratorEmailInput((current) => ({ ...current, [id]: "" }));
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/accounts or @maker/cloud-projects dev server running?)`
            : "Failed to add collaborator",
        );
      } finally {
        setCollaboratorBusy(false);
      }
    },
    [token, collaboratorEmailInput],
  );

  const handleRemoveCollaborator = useCallback(
    async (id: string, collaboratorUserId: string) => {
      if (!token) return;
      try {
        setCollaboratorBusy(true);
        setError(null);
        const response = await fetch(
          `${CLOUD_PROJECTS_URL}/projects/${id}/collaborators/${collaboratorUserId}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok && response.status !== 204) {
          setError(await readErrorMessage(response, "Couldn't remove collaborator"));
          return;
        }
        setCollaboratorsByProject((current) => ({
          ...current,
          [id]: (current[id] ?? []).filter((c) => c.userId !== collaboratorUserId),
        }));
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to remove collaborator",
        );
      } finally {
        setCollaboratorBusy(false);
      }
    },
    [token],
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
        if (loadedProjectId === id) {
          setLoadedProjectId(null);
          setLiveNotice(null);
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
    [token, refreshProjects, loadedProjectId],
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
      {liveNotice && (
        <p className="ai-panel__hint cloud-projects-panel__live-notice">
          {liveNotice === "deleted"
            ? "This project was deleted by its owner."
            : "This project was updated by a collaborator."}{" "}
          {liveNotice === "updated" && (
            <button type="button" onClick={handleReloadLive}>
              Reload
            </button>
          )}
          <button type="button" onClick={handleDismissLiveNotice}>
            Dismiss
          </button>
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
              {project.role === "collaborator" && (
                <span className="ai-panel__hint">Shared with you</span>
              )}
              <div className="ai-panel__actions">
                <button type="button" disabled={busy} onClick={() => void handleLoad(project.id)}>
                  Load
                </button>
                {project.role !== "collaborator" && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleShare(project.id)}
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(project.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
                <button type="button" disabled={busy} onClick={() => handleOpenPublish(project)}>
                  Publish to Library
                </button>
                <button type="button" onClick={() => void handleToggleCollaborators(project.id)}>
                  {openCollaboratorsFor === project.id ? "Hide collaborators" : "Collaborators"}
                </button>
              </div>
              {openCollaboratorsFor === project.id && (
                <div className="cloud-projects-panel__collaborators">
                  {(collaboratorsByProject[project.id] ?? []).length === 0 ? (
                    <p className="ai-panel__hint">No collaborators yet.</p>
                  ) : (
                    <ul>
                      {(collaboratorsByProject[project.id] ?? []).map((collaborator) => (
                        <li key={collaborator.userId}>
                          <span>{collaborator.userId}</span>
                          {project.role !== "collaborator" && (
                            <button
                              type="button"
                              disabled={collaboratorBusy}
                              onClick={() =>
                                void handleRemoveCollaborator(project.id, collaborator.userId)
                              }
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {project.role !== "collaborator" && (
                    <div className="ai-panel__actions">
                      <input
                        type="email"
                        placeholder="Collaborator's email"
                        value={collaboratorEmailInput[project.id] ?? ""}
                        disabled={collaboratorBusy}
                        onChange={(event) =>
                          setCollaboratorEmailInput((current) => ({
                            ...current,
                            [project.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={
                          collaboratorBusy || !(collaboratorEmailInput[project.id] ?? "").trim()
                        }
                        onClick={() => void handleAddCollaborator(project.id)}
                      >
                        Invite
                      </button>
                    </div>
                  )}
                </div>
              )}
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
