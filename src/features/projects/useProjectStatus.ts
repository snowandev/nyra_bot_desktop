import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowFocusRefresh } from "@/shared/hooks/useWindowFocusRefresh";
import { type Project, projectStatus, type ProjectStatus } from "./projectStorage";


// Whether each project's folder is still there and its Git branch, by project id. Read when the list changes; the
// open project also when the user comes back to the window, since a branch is usually changed from a terminal (every
// project then would mean several git processes for each).
export function useProjectStatus(projects: Project[], openProjectId: string | null) {
  const [statuses, setStatuses] = useState<Map<string, ProjectStatus>>(new Map());
  const latest = useRef({ projects, openProjectId });
  useEffect(() => {
    latest.current = { projects, openProjectId };
  });

  const refresh = useCallback(async (project: Project) => {
    try {
      const status = await projectStatus(project.path);
      // A read of the place the project was before it moved arrives late: it no longer says anything
      if (latest.current.projects.find((p) => p.id === project.id)?.path !== project.path) return;
      setStatuses((current) => new Map(current).set(project.id, status));
    } catch {
      // A folder Rust no longer allows reads as missing: Nyra can't work in it until it is picked again
      setStatuses((current) => new Map(current).set(project.id, { missing: true, git: null }));
    }
  }, []);

  const key = projects.map((p) => `${p.id}:${p.path}`).join("|");
  useEffect(() => {
    latest.current.projects.forEach((p) => void refresh(p));
  }, [key, refresh]);

  useWindowFocusRefresh(() => {
    const open = projects.find((p) => p.id === openProjectId);
    if (open) void refresh(open);
  });

  // The same function while no status changes, so the sidebar isn't drawn again for nothing
  const statusOf = useCallback((id: string) => statuses.get(id) ?? null, [statuses]);
  return { statusOf, refresh };
}
