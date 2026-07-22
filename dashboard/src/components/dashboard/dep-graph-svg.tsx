"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Maximize, Minus, Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { DepsMap, DepNode } from "./types";
import { ACCENT_HEX } from "./primitives";
import type { AccentColor } from "./types";

// ---------- Kind -> accent color ----------
const KIND_ACCENT: Record<string, AccentColor> = {
  npc: "amber",
  model: "emerald",
  anim: "rose",
  seq: "teal",
  "anim-base": "orange",
  script: "purple",
  obj: "rose",
  param: "neutral",
  sound: "neutral",
};

function kindColor(kind: string): string {
  return ACCENT_HEX[KIND_ACCENT[kind] || "neutral"];
}

function kindAccent(kind: string): AccentColor {
  return KIND_ACCENT[kind] || "neutral";
}

// ---------- Layout ----------
export type PositionedNode = {
  key: string;
  node: DepNode;
  depth: number;
  x: number;
  y: number;
  radius: number;
};

export type PositionedEdge = {
  id: string;
  fromKey: string;
  toKey: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  via?: string;
  missing?: boolean;
};

export type GraphLayout = {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
  maxDepth: number;
};

function nodeKey(kind: string, id: number | string): string {
  return `${kind}:${id}`;
}

function layoutGraph(depMap: DepsMap): GraphLayout {
  const rootKey = nodeKey(depMap.root.kind, depMap.root.id);
  const realNodes = depMap.nodes;

  // Build a full set of nodes including synthetic ones for missing deps
  const allNodes = new Map<string, DepNode>();
  for (const [key, node] of Object.entries(realNodes)) {
    allNodes.set(key, node);
  }
  // Add synthetic nodes for missing deps referenced in deps arrays
  for (const key of Object.keys(realNodes)) {
    const node = realNodes[key];
    for (const dep of node.deps) {
      const depKey = nodeKey(dep.kind, dep.id);
      if (!allNodes.has(depKey)) {
        allNodes.set(depKey, {
          kind: dep.kind,
          id: dep.id,
          name: null,
          source: "missing",
          transformedFrom: null,
          missing: true,
          deps: [],
        });
      }
    }
  }

  // BFS to compute depth (shortest path from root)
  const depthMap = new Map<string, number>();
  depthMap.set(rootKey, 0);
  const visited = new Set<string>([rootKey]);
  const queue: string[] = [rootKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const node = allNodes.get(key);
    if (!node) continue;
    const d = depthMap.get(key)!;
    for (const dep of node.deps) {
      const depKey = nodeKey(dep.kind, dep.id);
      if (!visited.has(depKey)) {
        visited.add(depKey);
        depthMap.set(depKey, d + 1);
        queue.push(depKey);
      }
    }
  }
  // For orphan nodes (shouldn't happen, but be safe), set max depth + 1
  let maxDepth = 0;
  for (const d of depthMap.values()) maxDepth = Math.max(maxDepth, d);
  for (const key of allNodes.keys()) {
    if (!depthMap.has(key)) {
      maxDepth += 1;
      depthMap.set(key, maxDepth);
    }
  }

  // Group keys by depth
  const byDepth = new Map<number, string[]>();
  for (const [key, d] of depthMap.entries()) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(key);
  }

  // Position nodes
  const RADIUS_STEP = 130;
  const positions = new Map<string, { x: number; y: number }>();
  const cx = 0;
  const cy = 0;

  for (const [d, keys] of byDepth.entries()) {
    if (d === 0) {
      const key = keys[0];
      positions.set(key, { x: cx, y: cy });
      continue;
    }
    const radius = d * RADIUS_STEP;
    const angleStep = (2 * Math.PI) / Math.max(keys.length, 1);
    // Stagger odd depths to reduce overlap with previous ring
    const angleOffset = d % 2 === 0 ? 0 : angleStep / 2;
    keys.forEach((key, i) => {
      const angle = i * angleStep + angleOffset - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      positions.set(key, { x, y });
    });
  }

  // Build positioned nodes
  const positionedNodes: PositionedNode[] = [];
  for (const key of allNodes.keys()) {
    const node = allNodes.get(key)!;
    const d = depthMap.get(key)!;
    const pos = positions.get(key) || { x: 0, y: 0 };
    positionedNodes.push({
      key,
      node,
      depth: d,
      x: pos.x,
      y: pos.y,
      radius: d === 0 ? 32 : 22,
    });
  }

  // Build positioned edges
  const positionedEdges: PositionedEdge[] = [];
  for (const key of allNodes.keys()) {
    const node = allNodes.get(key)!;
    const fromPos = positions.get(key);
    if (!fromPos) continue;
    for (const dep of node.deps) {
      const depKey = nodeKey(dep.kind, dep.id);
      const toPos = positions.get(depKey);
      if (!toPos) continue;
      positionedEdges.push({
        id: `${key}->${depKey}`,
        fromKey: key,
        toKey: depKey,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        via: dep.via,
        missing: dep.missing,
      });
    }
  }

  // Compute viewBox bounds
  const padding = 80;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of positionedNodes) {
    minX = Math.min(minX, n.x - n.radius);
    maxX = Math.max(maxX, n.x + n.radius);
    minY = Math.min(minY, n.y - n.radius);
    maxY = Math.max(maxY, n.y + n.radius);
  }
  if (!isFinite(minX)) {
    minX = -100; maxX = 100; minY = -100; maxY = 100;
  }
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  // Apply offset
  for (const n of positionedNodes) {
    n.x += offsetX;
    n.y += offsetY;
  }
  for (const e of positionedEdges) {
    e.fromX += offsetX;
    e.fromY += offsetY;
    e.toX += offsetX;
    e.toY += offsetY;
  }

  return { nodes: positionedNodes, edges: positionedEdges, width, height, maxDepth };
}

// ---------- Edge path (curved quadratic bezier) ----------
function edgePath(e: PositionedEdge): string {
  const midX = (e.fromX + e.toX) / 2;
  const midY = (e.fromY + e.toY) / 2;
  // Compute a slight curve perpendicular to the line
  const dx = e.toX - e.fromX;
  const dy = e.toY - e.fromY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const curveOffset = Math.min(len * 0.15, 30);
  const ctrlX = midX + perpX * curveOffset;
  const ctrlY = midY + perpY * curveOffset;
  return `M ${e.fromX} ${e.fromY} Q ${ctrlX} ${ctrlY} ${e.toX} ${e.toY}`;
}

// ---------- Main graph SVG component ----------
export function DepGraphSvg({
  depMap,
  selectedKey,
  onSelectNode,
  hoveredKey,
  onHoverNode,
  searchQuery,
}: {
  depMap: DepsMap;
  selectedKey: string | null;
  onSelectNode: (key: string | null) => void;
  hoveredKey: string | null;
  onHoverNode: (key: string | null) => void;
  searchQuery?: string;
}) {
  const layout = React.useMemo(() => layoutGraph(depMap), [depMap]);

  // Zoom + pan state
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStart = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Reset zoom/pan when dep map changes
  React.useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [depMap]);

  // Compute neighbor set for selected/hovered node
  const highlightKey = hoveredKey || selectedKey;
  const neighbors = React.useMemo(() => {
    if (!highlightKey) return new Set<string>();
    const set = new Set<string>([highlightKey]);
    for (const e of layout.edges) {
      if (e.fromKey === highlightKey) set.add(e.toKey);
      if (e.toKey === highlightKey) set.add(e.fromKey);
    }
    return set;
  }, [highlightKey, layout.edges]);

  // Search matches
  const searchMatches = React.useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return new Set<string>();
    const q = searchQuery.trim().toLowerCase();
    const matches = new Set<string>();
    for (const n of layout.nodes) {
      const label = (n.node.name || `${n.node.kind}:${n.node.id}`).toLowerCase();
      const fullKey = `${n.node.kind}:${n.node.id}`.toLowerCase();
      if (label.includes(q) || fullKey.includes(q)) {
        matches.add(n.key);
      }
    }
    return matches;
  }, [searchQuery, layout.nodes]);

  const hasSearch = searchMatches.size > 0;

  // Pan handlers (mouse only — touch would need touch event handlers)
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan when clicking on empty space (not on a node)
    if (e.target !== e.currentTarget && (e.target as Element).closest("[data-node-group]")) {
      return;
    }
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  };
  const handleMouseUp = () => {
    setIsDragging(false);
    dragStart.current = null;
  };
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  };

  // Zoom controls
  const zoomIn = () => setZoom((z) => Math.min(3, z * 1.2));
  const zoomOut = () => setZoom((z) => Math.max(0.3, z / 1.2));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      {/* Subtle radial background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.05), transparent 70%)",
        }}
      />
      {/* Zoom/pan controls overlay */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-md border border-neutral-200 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/90">
        <button
          type="button"
          onClick={zoomIn}
          className="flex size-7 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          className="flex size-7 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <Separator className="my-0.5" />
        <button
          type="button"
          onClick={resetView}
          className="flex size-7 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Reset view"
          title="Reset view"
        >
          <Maximize className="size-4" />
        </button>
      </div>

      {/* Zoom indicator */}
      <div className="absolute left-3 top-3 z-10 rounded-md border border-neutral-200 bg-white/90 px-2 py-1 font-mono text-[10px] text-neutral-600 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-800/90 dark:text-neutral-300">
        {Math.round(zoom * 100)}%
        {isDragging && <span className="ml-1.5 text-amber-600">· panning</span>}
      </div>

      <div
        ref={containerRef}
        className={`relative block max-h-[640px] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        onClick={() => onSelectNode(null)}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: isDragging ? "none" : "transform 0.15s ease-out",
        }}
      >
        <defs>
          {/* Arrowhead markers per kind color */}
          {Array.from(new Set(layout.nodes.map((n) => n.node.kind))).map((kind) => (
            <marker
              key={kind}
              id={`arrow-${kind}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={kindColor(kind)} opacity="0.7" />
            </marker>
          ))}
          <marker
            id="arrow-missing"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" opacity="0.6" />
          </marker>
        </defs>

        {/* Edges */}
        <g>
          {layout.edges.map((e) => {
            const isHighlighted =
              highlightKey && (e.fromKey === highlightKey || e.toKey === highlightKey);
            const isDimmed = highlightKey && !isHighlighted;
            return (
              <path
                key={e.id}
                d={edgePath(e)}
                fill="none"
                stroke={e.missing ? "#ef4444" : kindColor("neutral")}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeOpacity={isDimmed ? 0.1 : isHighlighted ? 0.85 : 0.4}
                strokeDasharray={e.missing ? "4 3" : undefined}
                markerEnd={`url(#${e.missing ? "arrow-missing" : `arrow-${layout.nodes.find((n) => n.key === e.toKey)?.node.kind || "neutral"}`})`}
                style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {layout.nodes
            .slice()
            .sort((a, b) => a.depth - b.depth)
            .map((n) => {
              const accent = kindAccent(n.node.kind);
              const color = kindColor(n.node.kind);
              const isSelected = selectedKey === n.key;
              const isHovered = hoveredKey === n.key;
              const isHighlighted = highlightKey && neighbors.has(n.key);
              const isSearchMatch = hasSearch && searchMatches.has(n.key);
              const isSearchDimmed = hasSearch && !isSearchMatch;
              const isDimmed = (highlightKey && !isHighlighted) || isSearchDimmed;
              const isMissing = !!n.node.missing;
              const isRoot = n.depth === 0;
              const label = n.node.name || `${n.node.kind}:${n.node.id}`;
              return (
                <motion.g
                  key={n.key}
                  data-node-group=""
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: isDimmed ? 0.2 : 1,
                    scale: 1,
                  }}
                  transition={{
                    delay: Math.min(n.depth * 0.08, 0.6),
                    type: "spring",
                    stiffness: 300,
                    damping: 24,
                  }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px`, cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(isSelected ? null : n.key);
                  }}
                  onMouseEnter={() => onHoverNode(n.key)}
                  onMouseLeave={() => onHoverNode(null)}
                >
                  {/* Outer glow ring when selected/hovered */}
                  {(isSelected || isHovered) && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.radius + 6}
                      fill="none"
                      stroke={color}
                      strokeWidth="2"
                      strokeOpacity="0.4"
                    />
                  )}

                  {/* Search match ring (purple) */}
                  {isSearchMatch && !isSelected && !isHovered && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.radius + 4}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="2"
                      strokeOpacity="0.6"
                      strokeDasharray="2 2"
                    />
                  )}

                  {/* Node circle */}
                  {isRoot ? (
                    // Root: double-ring rect
                    <g>
                      <rect
                        x={n.x - n.radius}
                        y={n.y - n.radius}
                        width={n.radius * 2}
                        height={n.radius * 2}
                        rx={10}
                        fill={color}
                        fillOpacity="0.15"
                        stroke={color}
                        strokeWidth="2.5"
                      />
                      <rect
                        x={n.x - n.radius + 4}
                        y={n.y - n.radius + 4}
                        width={(n.radius - 4) * 2}
                        height={(n.radius - 4) * 2}
                        rx={6}
                        fill="white"
                        stroke={color}
                        strokeWidth="1.5"
                      />
                    </g>
                  ) : isMissing ? (
                    // Missing node: hollow with red dashed border + warning bg tint
                    <g>
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.radius}
                        fill="#fef2f2"
                        fillOpacity={0.6}
                        stroke="#ef4444"
                        strokeWidth={isSelected ? 2.5 : 2}
                        strokeDasharray="4 3"
                      />
                      {/* Warning icon (triangle with !) */}
                      <path
                        d={`M ${n.x - 5} ${n.y + 3} L ${n.x + 5} ${n.y + 3} L ${n.x} ${n.y - 5} Z`}
                        fill="#ef4444"
                        fillOpacity={0.85}
                        stroke="#fef2f2"
                        strokeWidth={0.5}
                      />
                      <line
                        x1={n.x}
                        y1={n.y - 1}
                        x2={n.x}
                        y2={n.y + 1}
                        stroke="white"
                        strokeWidth={1.2}
                      />
                    </g>
                  ) : (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.radius}
                      fill={color}
                      fillOpacity={0.18}
                      stroke={color}
                      strokeWidth={isSelected ? 2.5 : 1.8}
                    />
                  )}

                  {/* Kind label inside node (hidden for missing — icon replaces it) */}
                  {!isMissing && (
                    <text
                      x={n.x}
                      y={n.y + 4}
                      textAnchor="middle"
                      fontSize={isRoot ? 11 : 10}
                      fontWeight="700"
                      fill={color}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {n.node.kind.length > 8 ? n.node.kind.slice(0, 7) + "…" : n.node.kind}
                    </text>
                  )}

                  {/* Name label below node — with background pill for readability */}
                  <LabelWithBackground
                    x={n.x}
                    y={n.y + n.radius + 14}
                    text={label}
                    isMissing={isMissing}
                    isRoot={isRoot}
                    isHighlighted={!!isHighlighted}
                  />

                  {/* Missing badge (top-right corner) */}
                  {isMissing && (
                    <g>
                      <rect
                        x={n.x + n.radius - 18}
                        y={n.y - n.radius - 8}
                        width={36}
                        height={14}
                        rx={7}
                        fill="#ef4444"
                      />
                      <text
                        x={n.x + n.radius}
                        y={n.y - n.radius + 2}
                        textAnchor="middle"
                        fontSize={8}
                        fontWeight={700}
                        fill="white"
                        style={{ pointerEvents: "none" }}
                      >
                        MISSING
                      </text>
                    </g>
                  )}
                </motion.g>
              );
            })}
        </g>
      </svg>
      </div>

      {/* Hover tooltip overlay */}
      {hoveredKey && (
        <HoverTooltip
          node={layout.nodes.find((n) => n.key === hoveredKey)?.node}
        />
      )}

      {/* Search matches indicator */}
      {hasSearch && (
        <div className="absolute bottom-3 left-3 z-10 rounded-md border border-purple-200 bg-purple-50/90 px-2 py-1 font-mono text-[10px] text-purple-700 shadow-sm backdrop-blur dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          {searchMatches.size} match{searchMatches.size === 1 ? "" : "es"} for &ldquo;{searchQuery}&rdquo;
        </div>
      )}
    </div>
  );
}

// ---------- Hover tooltip (positioned via floating state) ----------
function HoverTooltip({ node }: { node?: DepNode }) {
  if (!node) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-md border border-neutral-200 bg-white/95 p-3 text-xs shadow-md backdrop-blur">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: kindColor(node.kind) }}
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {node.kind}
        </span>
        {node.missing && (
          <span className="rounded-sm bg-red-100 px-1 text-[9px] font-bold text-red-700">
            MISSING
          </span>
        )}
      </div>
      <div className="font-mono text-xs font-semibold text-neutral-900">
        {node.name || `${node.kind}:${node.id}`}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        <dt className="text-neutral-400">id:</dt>
        <dd className="font-mono text-neutral-700">{String(node.id)}</dd>
        <dt className="text-neutral-400">source:</dt>
        <dd className="font-mono text-neutral-700">{node.source}</dd>
        {node.transformedFrom != null && (
          <>
            <dt className="text-neutral-400">from:</dt>
            <dd className="font-mono text-neutral-700">{String(node.transformedFrom)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------- Label with background pill (prevents overlap with edges) ----------
function LabelWithBackground({
  x,
  y,
  text,
  isMissing,
  isRoot,
  isHighlighted,
}: {
  x: number;
  y: number;
  text: string;
  isMissing: boolean;
  isRoot: boolean;
  isHighlighted: boolean;
}) {
  // Truncate long labels to keep them readable
  const maxLen = 22;
  const display = text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
  const fontSize = isRoot ? 11 : 10;
  const padding = 4;
  const approxWidth = display.length * fontSize * 0.6 + padding * 2;
  const approxHeight = fontSize + 4;
  const fillColor = isMissing ? "#fef2f2" : isHighlighted ? "white" : "rgba(255,255,255,0.92)";
  const textColor = isMissing ? "#ef4444" : isRoot ? "#171717" : "#404040";
  const fontWeight = isRoot ? 600 : 500;

  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={x - approxWidth / 2}
        y={y - fontSize}
        width={approxWidth}
        height={approxHeight}
        rx={3}
        fill={fillColor}
        stroke={isMissing ? "#fecaca" : "rgba(229,229,229,0.7)"}
        strokeWidth={0.5}
      />
      <text
        x={x}
        y={y - 1}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={fontWeight}
        fill={textColor}
        style={{ userSelect: "none" }}
      >
        {display}
      </text>
    </g>
  );
}

// ---------- Legend ----------
export function GraphLegend() {
  const items: { kind: string; label: string }[] = [
    { kind: "npc", label: "NPC" },
    { kind: "model", label: "Model" },
    { kind: "anim", label: "Animation" },
    { kind: "seq", label: "Sequence" },
    { kind: "anim-base", label: "Anim base" },
    { kind: "script", label: "Script" },
    { kind: "obj", label: "Object (often missing)" },
    { kind: "param", label: "Param" },
    { kind: "sound", label: "Sound" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {items.map((it) => (
        <div key={it.kind} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: kindColor(it.kind) }}
          />
          <span className="text-[10px] text-neutral-600">{it.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border border-dashed border-red-500" />
        <span className="text-[10px] text-neutral-600">missing</span>
      </div>
    </div>
  );
}
