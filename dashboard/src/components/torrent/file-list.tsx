"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import {
  CaretRight,
  Check,
  File,
  FileAudio,
  FileText,
  FileVideo,
  FileZip,
  Folder,
  FolderOpen,
} from "@phosphor-icons/react";
import { type TorrentFileRecord } from "@/lib/api";
import {
  buildFileTree,
  collectFolderPaths,
  flattenVisible,
  type FileNode,
  type FolderNode,
  type TreeNode,
} from "@/lib/file-tree";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { ProgressBar, toPct } from "@/components/ui/progress-bar";

const DRAG_THRESHOLD_PX = 4;
/** Expand everything by default only when the fully-expanded list stays small. */
const EXPAND_ALL_ROW_LIMIT = 30;

interface DragState {
  /** Page coordinates — immune to wheel scrolling mid-drag. */
  originX: number;
  originY: number;
  additive: boolean;
  baseSelection: Set<string>;
  started: boolean;
}

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Reported to the page whenever 2+ files are selected, so the Section header
    can host the bulk actions without pushing the list around. */
export interface FileSelectionSummary {
  count: number;
  size: number;
  indices: number[];
  clear: () => void;
}

/** Finder-style file tree: collapsible folders with aggregate progress and
    tri-state checkboxes, plus click/⌘/⇧ and rubber-band selection whose sole
    action is bulk wanted-toggling via any selected row's checkbox. */
export function FileList({
  files,
  onSetWanted,
  downloading,
  stalled,
  pollPausedRef,
  onSelectionChange,
}: {
  files: TorrentFileRecord[];
  /** Apply a wanted state to a batch of original file indices in one call. */
  onSetWanted: (indices: number[], wanted: boolean) => void;
  downloading: boolean;
  stalled: boolean;
  /** Page's poll gate — held true while a marquee drag is in flight. */
  pollPausedRef: { current: boolean };
  /** Fires with a summary at 2+ selected files, null otherwise. */
  onSelectionChange?: (selection: FileSelectionSummary | null) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const fileByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === "file") map.set(node.path, node);
        else walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  // null until the user's first toggle; before that the derived default applies,
  // so expansion needs no init effect and survives the files arriving async.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const defaultExpanded = useMemo(() => {
    const folderPaths = collectFolderPaths(tree);
    return files.length + folderPaths.length <= EXPAND_ALL_ROW_LIMIT
      ? new Set(folderPaths)
      : new Set(folderPaths.filter((p) => !p.includes("/")));
  }, [tree, files.length]);
  const effectiveExpanded = expanded ?? defaultExpanded;

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const anchorPathRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const suppressClickRef = useRef(false);

  const visible = useMemo(() => flattenVisible(tree, effectiveExpanded), [tree, effectiveExpanded]);
  const selectedFiles = useMemo(
    () =>
      [...selectedPaths]
        .map((p) => fileByPath.get(p))
        .filter((f): f is FileNode => f !== undefined),
    [selectedPaths, fileByPath]
  );

  useEffect(() => {
    if (!onSelectionChange) return;
    if (selectedFiles.length >= 2) {
      onSelectionChange({
        count: selectedFiles.length,
        size: selectedFiles.reduce((s, f) => s + f.size, 0),
        indices: selectedFiles.map((f) => f.index),
        clear: () => {
          setSelectedPaths(new Set());
          anchorPathRef.current = null;
        },
      });
    } else {
      onSelectionChange(null);
    }
    return () => onSelectionChange(null);
  }, [selectedFiles, onSelectionChange]);

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No file information available yet.</p>;
  }

  const registerRow = (path: string): Ref<HTMLDivElement> => (el) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  };

  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev ?? defaultExpanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleRowClick = (node: TreeNode, e: ReactMouseEvent) => {
    if (suppressClickRef.current) return;
    const mod = e.metaKey || e.ctrlKey;

    if (node.kind === "file") {
      if (e.shiftKey && anchorPathRef.current) {
        const a = visible.findIndex((n) => n.path === anchorPathRef.current);
        const b = visible.findIndex((n) => n.path === node.path);
        if (a !== -1 && b !== -1) {
          // Range over visible rows only — collapsed descendants stay out.
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = new Set<string>();
          for (let i = lo; i <= hi; i++) {
            const row = visible[i];
            if (row.kind === "file") range.add(row.path);
          }
          setSelectedPaths(range);
          return;
        }
      }
      if (mod) {
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(node.path)) next.delete(node.path);
          else next.add(node.path);
          return next;
        });
      } else {
        setSelectedPaths(new Set([node.path]));
      }
      anchorPathRef.current = node.path;
      return;
    }

    // Folder body: the selection target is every descendant file, collapsed or not.
    const paths = node.fileIndices.map((i) => files[i].path);
    if (mod) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        const allIn = paths.every((p) => next.has(p));
        for (const p of paths) {
          if (allIn) next.delete(p);
          else next.add(p);
        }
        return next;
      });
    } else {
      setSelectedPaths(new Set(paths));
    }
    anchorPathRef.current = node.path;
  };

  const clearSelection = () => {
    setSelectedPaths(new Set());
    anchorPathRef.current = null;
  };

  const handleContainerClick = (e: ReactMouseEvent) => {
    if (suppressClickRef.current) return;
    if ((e.target as HTMLElement).closest("[data-row]")) return;
    clearSelection();
  };

  const handleFileCheckbox = (file: FileNode) => {
    const target = !file.selected;
    if (selectedPaths.has(file.path) && selectedFiles.length > 1) {
      onSetWanted(selectedFiles.map((f) => f.index), target);
    } else {
      onSetWanted([file.index], target);
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const additive = e.metaKey || e.ctrlKey;
    dragRef.current = {
      originX: e.clientX + window.scrollX,
      originY: e.clientY + window.scrollY,
      additive,
      baseSelection: additive ? new Set(selectedPaths) : new Set(),
      started: false,
    };
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events carry no active pointer; bubbling still works.
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;
    if (!drag.started) {
      if (Math.hypot(x - drag.originX, y - drag.originY) < DRAG_THRESHOLD_PX) return;
      drag.started = true;
      pollPausedRef.current = true;
    }

    const left = Math.min(drag.originX, x);
    const top = Math.min(drag.originY, y);
    const right = Math.max(drag.originX, x);
    const bottom = Math.max(drag.originY, y);

    // Re-measure every move: page coords + fresh rects make mid-drag scrolling
    // and re-renders correct by construction. Folders are skipped — the band
    // selects files; a folder's visible children get hit individually.
    const hits = new Set<string>();
    for (const [path, el] of rowRefs.current) {
      if (!fileByPath.has(path)) continue;
      const r = el.getBoundingClientRect();
      const rl = r.left + window.scrollX;
      const rt = r.top + window.scrollY;
      if (rl < right && rl + r.width > left && rt < bottom && rt + r.height > top) {
        hits.add(path);
      }
    }
    setSelectedPaths(drag.additive ? new Set([...drag.baseSelection, ...hits]) : hits);

    const c = containerRef.current?.getBoundingClientRect();
    if (c) {
      setMarquee({
        left: left - (c.left + window.scrollX),
        top: top - (c.top + window.scrollY),
        width: right - left,
        height: bottom - top,
      });
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.started) {
      // Swallow the trailing click so it can't clear the fresh selection.
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    setMarquee(null);
    pollPausedRef.current = false;
  };

  return (
    <div
      ref={containerRef}
      className="relative select-none divide-y divide-border/50"
      onClick={handleContainerClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {visible.map((node) =>
        node.kind === "file" ? (
          <FileRow
            key={node.path}
            file={node}
            highlighted={selectedPaths.has(node.path)}
            downloading={downloading}
            stalled={stalled}
            registerRef={registerRow(node.path)}
            onClick={(e) => handleRowClick(node, e)}
            onCheckbox={() => handleFileCheckbox(node)}
          />
        ) : (
          <FolderRow
            key={node.path}
            folder={node}
            highlighted={
              node.fileIndices.length > 0 &&
              node.fileIndices.every((i) => selectedPaths.has(files[i].path))
            }
            isExpanded={effectiveExpanded.has(node.path)}
            downloading={downloading}
            stalled={stalled}
            registerRef={registerRow(node.path)}
            onClick={(e) => handleRowClick(node, e)}
            onCheckbox={() => onSetWanted(node.fileIndices, node.wanted !== "all")}
            onToggleExpand={() => toggleExpand(node.path)}
          />
        )
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute z-10 rounded-sm border border-primary/40 bg-primary/10"
          style={marquee}
        />
      )}
    </div>
  );
}

const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "flac", "m4a", "ogg", "wav"]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "gz", "tar"]);
const TEXT_EXTS = new Set(["srt", "sub", "txt", "nfo", "md"]);

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const Icon = VIDEO_EXTS.has(ext)
    ? FileVideo
    : AUDIO_EXTS.has(ext)
      ? FileAudio
      : ARCHIVE_EXTS.has(ext)
        ? FileZip
        : TEXT_EXTS.has(ext)
          ? FileText
          : File;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** Fixed-width progress column: bar + % while moving, a green check once done —
    every row's right edge stays in the same grid. */
function ProgressCell({
  done,
  value,
  shine,
  stalled,
  label,
}: {
  done: boolean;
  value: number;
  shine: boolean;
  stalled: boolean;
  label: string;
}) {
  return (
    <span className="flex w-[132px] shrink-0 items-center justify-end gap-2">
      {done ? (
        <Check weight="bold" className="h-3.5 w-3.5 text-done" aria-label="Complete" />
      ) : (
        <>
          <ProgressBar
            value={value}
            variant="list"
            shine={shine}
            stalled={stalled}
            className="w-24"
            label={label}
          />
          <span className="w-9 text-right text-2xs tabular-nums text-muted-foreground">
            {toPct(value)}%
          </span>
        </>
      )}
    </span>
  );
}

function FileRow({
  file,
  highlighted,
  downloading,
  stalled,
  registerRef,
  onClick,
  onCheckbox,
}: {
  file: FileNode;
  highlighted: boolean;
  downloading: boolean;
  stalled: boolean;
  registerRef: Ref<HTMLDivElement>;
  onClick: (e: ReactMouseEvent) => void;
  onCheckbox: () => void;
}) {
  return (
    <div
      data-row=""
      ref={registerRef}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 py-1.5 pl-2 pr-3 text-sm transition-colors hover:bg-muted/50",
        !file.selected && "opacity-50",
        highlighted && "bg-primary/10 hover:bg-primary/10"
      )}
    >
      <span data-no-drag="" onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox
          checked={file.selected}
          onChange={onCheckbox}
          title={file.selected ? "Skip this file" : "Download this file"}
        />
      </span>
      <span className="w-6 shrink-0" style={{ marginLeft: file.depth * 20 }} />
      <FileTypeIcon name={file.name} />
      <MiddleTruncate
        text={file.name}
        className={cn("min-w-0 flex-1 text-xs", !file.selected && "line-through")}
      />
      <ProgressCell
        done={file.progress >= 1}
        value={file.progress}
        shine={downloading && file.selected && file.progress < 1}
        stalled={stalled}
        label={`${file.name}: ${toPct(file.progress)}%`}
      />
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatBytes(file.size)}
      </span>
    </div>
  );
}

function FolderRow({
  folder,
  highlighted,
  isExpanded,
  downloading,
  stalled,
  registerRef,
  onClick,
  onCheckbox,
  onToggleExpand,
}: {
  folder: FolderNode;
  highlighted: boolean;
  isExpanded: boolean;
  downloading: boolean;
  stalled: boolean;
  registerRef: Ref<HTMLDivElement>;
  onClick: (e: ReactMouseEvent) => void;
  onCheckbox: () => void;
  onToggleExpand: () => void;
}) {
  const agg = folder.size > 0 ? folder.progressBytes / folder.size : 0;
  const FolderIcon = isExpanded ? FolderOpen : Folder;
  return (
    <div
      data-row=""
      ref={registerRef}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 py-1.5 pl-2 pr-3 text-sm transition-colors hover:bg-muted/50",
        folder.wanted === "none" && "opacity-50",
        highlighted && "bg-primary/10 hover:bg-primary/10"
      )}
    >
      <span data-no-drag="" onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox
          checked={folder.wanted === "all"}
          indeterminate={folder.wanted === "mixed"}
          onChange={onCheckbox}
          title={folder.wanted === "all" ? "Skip this folder" : "Download this folder"}
          aria-label={`Toggle all files in ${folder.name}`}
        />
      </span>
      <button
        type="button"
        data-no-drag=""
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        style={{ marginLeft: folder.depth * 20 }}
      >
        <CaretRight
          className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
          weight="bold"
        />
      </button>
      <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" weight="fill" />
      <p className="min-w-0 flex-1 truncate text-xs font-medium">
        {folder.name}
        <span className="ml-1.5 font-normal text-muted-foreground">({folder.fileCount})</span>
      </p>
      <ProgressCell
        done={agg >= 1}
        value={agg}
        shine={downloading && folder.wanted !== "none" && agg < 1}
        stalled={stalled}
        label={`${folder.name}: ${toPct(agg)}%`}
      />
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatBytes(folder.size)}
      </span>
    </div>
  );
}
