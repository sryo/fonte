import type { TorrentFileRecord } from "./api-types";

export interface FileNode {
  kind: "file";
  /** Full torrent-relative path — the stable identity across polls. */
  path: string;
  name: string;
  /** Original array position — this IS the Transmission file index. */
  index: number;
  size: number;
  progress: number;
  selected: boolean;
  /** Transmission bandwidth tier: -1 low, 0 normal, 1 high. */
  priority: number;
  depth: number;
}

export interface FolderNode {
  kind: "folder";
  path: string;
  name: string;
  depth: number;
  children: TreeNode[];
  size: number;
  /** Σ(size × progress) over descendant files; aggregate = progressBytes / size. */
  progressBytes: number;
  wanted: "all" | "none" | "mixed";
  /** All descendant file indices, recursively. */
  fileIndices: number[];
  fileCount: number;
}

export type TreeNode = FileNode | FolderNode;

/** Fold files into a tree by path segments. Files without a separator stay
    root-level, so single-file torrents render flat with no synthetic root. */
export function buildFileTree(files: TorrentFileRecord[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();
  const selectedCount = new Map<string, number>();

  const folderFor = (segments: string[]): FolderNode => {
    const key = segments.join("/");
    const existing = folders.get(key);
    if (existing) return existing;
    const node: FolderNode = {
      kind: "folder",
      path: key,
      name: segments[segments.length - 1],
      depth: segments.length - 1,
      children: [],
      size: 0,
      progressBytes: 0,
      wanted: "all",
      fileIndices: [],
      fileCount: 0,
    };
    folders.set(key, node);
    const siblings = segments.length === 1 ? roots : folderFor(segments.slice(0, -1)).children;
    siblings.push(node);
    return node;
  };

  files.forEach((file, index) => {
    const segments = file.path.split("/").filter((s) => s && s !== ".");
    const leaf: FileNode = {
      kind: "file",
      path: file.path,
      name: file.name,
      index,
      size: file.size,
      progress: file.progress,
      selected: file.selected,
      priority: file.priority ?? 0,
      depth: segments.length - 1,
    };
    if (segments.length <= 1) {
      roots.push(leaf);
      return;
    }
    folderFor(segments.slice(0, -1)).children.push(leaf);
    for (let d = 1; d < segments.length; d++) {
      const ancestor = folderFor(segments.slice(0, d));
      ancestor.size += file.size;
      ancestor.progressBytes += file.size * file.progress;
      ancestor.fileIndices.push(index);
      ancestor.fileCount += 1;
      if (file.selected) selectedCount.set(ancestor.path, (selectedCount.get(ancestor.path) ?? 0) + 1);
    }
  });

  for (const folder of folders.values()) {
    const picked = selectedCount.get(folder.path) ?? 0;
    folder.wanted = picked === folder.fileCount ? "all" : picked === 0 ? "none" : "mixed";
  }

  return roots;
}

/** Depth-first walk emitting each folder followed by its children only when
    expanded. The result IS the display order — rendering, shift-click ranges,
    and marquee hit testing all share it. */
export function flattenVisible(roots: TreeNode[], expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.kind === "folder" && expanded.has(node.path)) walk(node.children);
    }
  };
  walk(roots);
  return out;
}

export function collectFolderPaths(roots: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        out.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(roots);
  return out;
}
