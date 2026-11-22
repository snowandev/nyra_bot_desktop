import { currentLocale } from "@/shared/i18n/i18n";
import type { Conversation, Message } from "@/shared/types";

type TreeNode = {
  name: string;
  // Relative to the project's folder, with forward slashes like the index
  path: string;
  children?: TreeNode[];
};

// One collator per language for every comparison: creating one per comparison is slow with thousands of files
let sorting = { locale: "", collator: new Intl.Collator() };
const sortingCollator = () => {
  const locale = currentLocale();
  if (sorting.locale !== locale) sorting = { locale, collator: new Intl.Collator(locale) };
  return sorting.collator;
};

// Folders first, then files, each alphabetically by the rules of the interface's language
const byKindAndName = (compare: Intl.Collator) => (a: TreeNode, b: TreeNode) =>
  Number(!a.children) - Number(!b.children) || compare.compare(a.name, b.name);

// The folder's index as a tree. Folders are found by their path, so a folder with thousands of files isn't searched
// once for each of them.
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const folderAt = (path: string): TreeNode => {
    const known = folders.get(path);
    if (known) return known;
    const cut = path.lastIndexOf("/");
    const folder: TreeNode = { name: path.slice(cut + 1), path, children: [] };
    folderAt(cut < 0 ? "" : path.slice(0, cut)).children?.push(folder);
    folders.set(path, folder);
    return folder;
  };
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    folderAt(cut < 0 ? "" : path.slice(0, cut)).children?.push({ name: path.slice(cut + 1), path });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes.sort(byKindAndName(sortingCollator())).map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children ?? []);
}

export type FileMarks = { read: boolean; proposed: boolean; applied: boolean };

// What a conversation did with each file: read it, proposed a change still to review, or applied one. A file with
// a change was read too, even if the reply had it from an earlier one.
export function marksOf(conversation: Conversation | null): Map<string, FileMarks> {
  const marks = new Map<string, FileMarks>();
  for (const message of conversation?.messages ?? []) {
    for (const [path, key] of marksIn(message)) {
      const current = marks.get(path) ?? { read: false, proposed: false, applied: false };
      marks.set(path, { ...current, [key]: true });
    }
  }
  return marks;
}

// A reply's marks are worked out once: while one is being written the others keep their object
const messageMarks = new WeakMap<Message, [string, keyof FileMarks][]>();

function marksIn(message: Message) {
  const known = messageMarks.get(message);
  if (known) return known;
  const found: [string, keyof FileMarks][] = [
    ...(message.workspaceConsult?.read ?? []).map((read): [string, keyof FileMarks] => [read.path, "read"]),
    ...(message.workspaceChanges ?? []).flatMap((change): [string, keyof FileMarks][] =>
      change.status === "pending"
        ? [[change.path, "proposed"]]
        : change.status === "applied"
          ? [[change.copiedTo ?? change.path, "applied"]]
          : [],
    ),
  ];
  messageMarks.set(message, found);
  return found;
}

// Whether two sets of marks say the same, so the tree isn't drawn again while a reply only adds text
export function sameMarks(a: Map<string, FileMarks>, b: Map<string, FileMarks>) {
  if (a.size !== b.size) return false;
  for (const [path, mark] of a) {
    const other = b.get(path);
    if (!other || other.read !== mark.read || other.proposed !== mark.proposed || other.applied !== mark.applied) {
      return false;
    }
  }
  return true;
}

// The folders that hold a marked file, for the dot of a folded folder, worked out once instead of for each folder
export function foldersHolding(marks: Map<string, FileMarks>) {
  const folders = new Set<string>();
  for (const [path, mark] of marks) {
    if (!hasMark(mark)) continue;
    for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/", cut - 1)) folders.add(path.slice(0, cut));
  }
  return folders;
}

const hasMark = (marks: FileMarks | undefined) => !!marks && (marks.read || marks.proposed || marks.applied);

// "De esta conversación": only the files the conversation touched, and the folders that hold them
export function onlyMarked(nodes: TreeNode[], marks: Map<string, FileMarks>): TreeNode[] {
  return nodes.flatMap((node) => {
    if (!node.children) return hasMark(marks.get(node.path)) ? [node] : [];
    const children = onlyMarked(node.children, marks);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

export type TreeRow = { node: TreeNode; level: number };

// The rows on screen, in order: each folder followed by its children when it is open
export function visibleRows(nodes: TreeNode[], isOpen: (path: string) => boolean, level = 1): TreeRow[] {
  return nodes.flatMap((node) => [
    { node, level },
    ...(node.children && isOpen(node.path) ? visibleRows(node.children, isOpen, level + 1) : []),
  ]);
}

// Which rows of a long list to draw: those in view, and a few more on each side so scrolling doesn't show gaps.
// top is how far the list has scrolled past the top of what is seen.
export function rowsInView(top: number, viewHeight: number, count: number, rowHeight: number, extra = 10) {
  const first = Math.max(0, Math.floor(top / rowHeight) - extra);
  const last = Math.min(count, Math.ceil((top + viewHeight) / rowHeight) + extra);
  return { first, last: Math.max(first, last) };
}
