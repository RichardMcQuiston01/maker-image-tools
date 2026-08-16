import { useEffect, useState } from "react";

function readRoute(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

/**
 * Minimal, dependency-free hash router. Enough for Stage 0's placeholder
 * navigation (home vs. editor); swap for a real router once the app has
 * more than a couple of views.
 */
export function useHashRoute(): string {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
