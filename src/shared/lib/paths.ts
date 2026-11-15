// Paths as Nyra keeps them inside a folder: relative, with "/" on every system

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// The folders before the name, with their last "/"; empty for a file at the top
export const folderPrefix = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

export const splitPath = (path: string) => ({ name: fileName(path), folder: folderPrefix(path).slice(0, -1) });

// "Informe.PDF" → "pdf"; the whole name when it has no dot
export const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
