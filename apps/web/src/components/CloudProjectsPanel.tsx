import { useCallback, useEffect, useState } from "react";
import type { VectorDocument } from "@maker/core-vector";
import { useAuth } from "../hooks/useAuth";
import { CLOUD_PROJECTS_URL } from "../lib/cloudProjectsUrl";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface CloudProjectsPanelProps {
  document: VectorDocument;
  onLoadDocument: (doc: VectorDocument) => void;
}

export function CloudProjectsPanel({
  document: vectorDocument,
  onLoadDocument,
}: CloudProjectsPanelProps) {
  const { status: authStatus, user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<{ projectId: string; token: string } | null>(null);

  const refreshProjects = useCallback(async (userId: string) => {
    try {
      const response = await fetch(`${CLOUD_PROJECTS_URL}/projects?userId=${userId}`);
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
    if (authStatus === "signed-in" && user) {
      void refreshProjects(user.id);
    } else {
      setProjects([]);
    }
  }, [authStatus, user, refreshProjects]);

  const handleSave = useCallback(async () => {
    if (!user || !name.trim()) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${CLOUD_PROJECTS_URL}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, name: name.trim(), data: vectorDocument }),
      });
      if (!response.ok) {
        throw new Error(`Save failed with ${response.status}`);
      }
      setName("");
      await refreshProjects(user.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/cloud-projects dev server running?)`
          : "Failed to save project",
      );
    } finally {
      setBusy(false);
    }
  }, [user, name, vectorDocument, refreshProjects]);

  const handleLoad = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}?userId=${user.id}`);
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
    [user, onLoadDocument],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}?userId=${user.id}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Delete failed with ${response.status}`);
        }
        await refreshProjects(user.id);
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
    [user, refreshProjects],
  );

  const handleShare = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        setBusy(true);
        setError(null);
        const response = await fetch(`${CLOUD_PROJECTS_URL}/projects/${id}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        if (!response.ok) {
          throw new Error(`Share failed with ${response.status}`);
        }
        const { token } = (await response.json()) as { token: string };
        setShareInfo({ projectId: id, token });
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
    [user],
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
              </div>
              {shareInfo?.projectId === project.id && (
                <p className="ai-panel__hint">Share token: {shareInfo.token}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
