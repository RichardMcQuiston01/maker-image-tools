import { useEffect, useState } from "react";
import type { VectorDocument } from "@maker/core-vector";
import { CLOUD_PROJECTS_URL } from "../lib/cloudProjectsUrl";

interface SharedProjectPanelProps {
  /** The full hash route, e.g. "/shared/<token>". */
  route: string;
  onLoadDocument: (doc: VectorDocument) => void;
}

interface SharedProject {
  id: string;
  name: string;
  data: VectorDocument;
  hasThumbnail: boolean;
}

/**
 * Landing spot for a `@maker/cloud-projects` share link
 * (`.../#/shared/<token>`) - fetches the shared project with no auth
 * required (matching the service's own public `GET /shared/:token`
 * contract) and lets the viewer open it in the editor.
 */
export function SharedProjectPanel({ route, onLoadDocument }: SharedProjectPanelProps) {
  const token = route.slice("/shared/".length);
  const [project, setProject] = useState<SharedProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`${CLOUD_PROJECTS_URL}/shared/${token}`);
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This share link is invalid or has been revoked."
              : `Cloud projects service responded with ${response.status}`,
          );
        }
        const body = (await response.json()) as { project: SharedProject };
        if (cancelled) return;
        setProject(body.project);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/cloud-projects dev server running?)`
            : "Failed to load the shared project",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleOpen = () => {
    if (!project) return;
    onLoadDocument(project.data);
    window.location.hash = "#/editor";
  };

  if (error) {
    return (
      <div className="shared-project">
        <p role="alert" className="shared-project__error">
          {error}
        </p>
        <a href="#/editor">Back to the editor</a>
      </div>
    );
  }

  if (!project) {
    return <p className="shared-project__hint">Loading shared project…</p>;
  }

  return (
    <div className="shared-project">
      {project.hasThumbnail && (
        <img
          className="shared-project__thumbnail"
          src={`${CLOUD_PROJECTS_URL}/shared/${token}/thumbnail`}
          alt={`Thumbnail for ${project.name}`}
        />
      )}
      <h2>{project.name}</h2>
      <p className="shared-project__hint">Someone shared this design with you.</p>
      <button type="button" onClick={handleOpen}>
        Open in editor
      </button>
    </div>
  );
}
