import { useEffect, useState } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { errorMessage } from "@/shared/lib/errors";
import type { WorkspaceFolder } from "@/shared/types";
import { sortProjects } from "./projects";
import {
  addProject,
  listProjects,
  type Project,
  relocateProject,
  removeProject,
  renameProject,
  restoreProject,
  setProjectDisabledSkills,
  setProjectModel,
} from "./projectStorage";

// The folder picker of the connected folders, which also allows the folder for Nyra
type PickFolder = (remember: boolean) => Promise<WorkspaceFolder | null>;

// The projects of the Código space. Actions reject with the reason (in Spanish) so it is shown where the user acted.
// onLoaded runs once, when the list is first read.
export function useProjects(pickFolder: PickFolder, onLoaded?: (projects: Project[]) => void) {
  const loaded = useStableCallback((list: Project[]) => onLoaded?.(list));
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(sortProjects(list));
        loaded(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // After an import, which can add projects for the folders its conversations come from
  async function reload() {
    try {
      setProjects(sortProjects(await listProjects()));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // null when the user closes the picker
  async function add() {
    const folder = await pickFolder(true);
    if (!folder) return null;
    const project = await addProject(crypto.randomUUID(), folder.path, folder.name);
    setProjects((list) => sortProjects([...list.filter((p) => p.id !== project.id), project]));
    return project;
  }

  // «Buscar la carpeta…»: null when the user closes the picker
  async function relocate(id: string) {
    const folder = await pickFolder(true);
    if (!folder) return null;
    const project = await relocateProject(id, folder.path);
    setProjects((list) => list.map((p) => (p.id === id ? project : p)));
    return project;
  }

  async function restore(id: string) {
    const project = await restoreProject(id);
    setProjects((list) => sortProjects([...list.filter((p) => p.id !== id), project]));
    return project;
  }

  async function rename(id: string, name: string) {
    const stored = await renameProject(id, name);
    setProjects((list) => sortProjects(list.map((p) => (p.id === id ? { ...p, name: stored } : p))));
  }

  async function setModel(id: string, model: string | null) {
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, model } : p)));
    await setProjectModel(id, model);
  }

  async function setDisabledSkills(id: string, names: string[]) {
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, disabledSkills: names } : p)));
    await setProjectDisabledSkills(id, names);
  }

  async function remove(id: string) {
    await removeProject(id);
    setProjects((list) => list.filter((p) => p.id !== id));
  }

  return { projects, isLoaded, error, reload, add, relocate, restore, rename, setModel, setDisabledSkills, remove };
}
