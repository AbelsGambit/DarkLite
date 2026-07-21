"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Box,
  GitBranch,
  Info,
  Network,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  EmptyState,
  SectionHeader,
  ShimmerSkeleton,
  staggerContainer,
  staggerItem,
} from "./primitives";
import { useDepsList, useDepsMap, useRecentDepMaps } from "./hooks";
import { DepGraphSvg, GraphLegend } from "./dep-graph-svg";
import { EditHistoryTimeline } from "./edit-history-timeline";
import { RecentDepMaps } from "./recent-dep-maps";
import type { DepNode } from "./types";

// ---------- Node details panel ----------
function NodeDetailsPanel({
  node,
  allNodes,
}: {
  node: DepNode | null;
  allNodes: Record<string, DepNode>;
}) {
  if (!node) {
    return (
      <Card className="border-dashed border-neutral-300 bg-neutral-50/60">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Info className="size-6 text-neutral-300" />
          <p className="text-sm text-neutral-500">
            Click a node in the graph to see its details and dependency list.
          </p>
        </CardContent>
      </Card>
    );
  }

  const depList = node.deps;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="border-neutral-200/80 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate font-mono text-sm font-semibold text-neutral-900">
                {node.name || `${node.kind}:${node.id}`}
              </CardTitle>
              <CardDescription className="mt-0.5 font-mono text-[11px]">
                {node.kind}:{String(node.id)}
              </CardDescription>
            </div>
            {node.missing && (
              <Badge className="shrink-0 border-red-200 bg-red-50 text-red-700">
                <AlertTriangle className="mr-1 size-3" />
                missing
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-neutral-500">Kind</dt>
            <dd className="font-mono text-neutral-900">{node.kind}</dd>
            <dt className="text-neutral-500">ID</dt>
            <dd className="font-mono text-neutral-900">{String(node.id)}</dd>
            <dt className="text-neutral-500">Source</dt>
            <dd className="font-mono text-neutral-900">{node.source}</dd>
            {node.transformedFrom != null && (
              <>
                <dt className="text-neutral-500">Transformed from</dt>
                <dd className="font-mono text-neutral-900">
                  {String(node.transformedFrom)}
                </dd>
              </>
            )}
            {node.cycle && (
              <>
                <dt className="text-neutral-500">Cycle</dt>
                <dd className="font-mono text-rose-700">yes — back-edge</dd>
              </>
            )}
          </dl>
          <Separator />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Dependencies
              </h4>
              <Badge variant="outline" className="font-mono text-[10px]">
                {depList.length}
              </Badge>
            </div>
            {depList.length === 0 ? (
              <p className="text-xs text-neutral-400">No deps — leaf node.</p>
            ) : (
              <ul className="space-y-1">
                {depList.map((dep, i) => {
                  const depKey = `${dep.kind}:${dep.id}`;
                  const depNode = allNodes[depKey];
                  const exists = !!depNode || !dep.missing;
                  return (
                    <li
                      key={i}
                      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                        dep.missing
                          ? "border-red-200 bg-red-50/60"
                          : "border-neutral-200 bg-neutral-50"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: dep.missing
                              ? "#ef4444"
                              : kindColor(dep.kind),
                          }}
                        />
                        <code className="truncate font-mono text-[11px] text-neutral-700">
                          {dep.kind}:{String(dep.id)}
                        </code>
                        {dep.via && (
                          <span className="truncate font-mono text-[10px] text-neutral-400">
                            via {dep.via}
                          </span>
                        )}
                      </div>
                      {dep.missing ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-red-200 bg-red-50 text-[9px] text-red-700"
                        >
                          missing
                        </Badge>
                      ) : !exists ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-200 bg-amber-50 text-[9px] text-amber-700"
                        >
                          untraced
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function kindColor(kind: string): string {
  const map: Record<string, string> = {
    npc: "#f59e0b",
    model: "#10b981",
    anim: "#f43f5e",
    seq: "#14b8a6",
    "anim-base": "#f97316",
    script: "#a855f7",
    obj: "#ef4444",
    param: "#737373",
    sound: "#737373",
  };
  return map[kind] || "#737373";
}

// ---------- Summary stats ----------
function GraphStats({ nodes, missing, cycles }: { nodes: number; missing: number; cycles: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="font-mono text-[10px]">
        <Network className="mr-1 size-3" />
        {nodes} nodes
      </Badge>
      {missing > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-help border-red-200 bg-red-50 font-mono text-[10px] text-red-700"
            >
              <AlertTriangle className="mr-1 size-3" />
              {missing} missing
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px] text-xs">
            Missing dependencies are assets referenced by this NPC's scripts or
            configs that haven't been ported from the OSRS cache yet (e.g. items
            like the fire shield, particle systems, or sound effects). They're
            recorded in the dep map so you know what to port next.
          </TooltipContent>
        </Tooltip>
      )}
      {cycles > 0 && (
        <Badge
          variant="outline"
          className="border-rose-200 bg-rose-50 font-mono text-[10px] text-rose-700"
        >
          <GitBranch className="mr-1 size-3" />
          {cycles} cycles
        </Badge>
      )}
    </div>
  );
}

// ---------- Main dependency graph tab ----------
export function DependencyGraphTab() {
  const { data: listData, loading: listLoading } = useDepsList();
  const { data: recentData, reload: reloadRecent } = useRecentDepMaps();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [name, setName] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const { data: depMap, loading: mapLoading, error, reload } = useDepsMap(name);

  // Auto-select first available if not set, OR pick up a pending dep map
  // requested by another tab (e.g. the NPC detail drawer).
  React.useEffect(() => {
    // Check for a pending dep map request from another tab
    try {
      const pending = sessionStorage.getItem("pendingDepMap");
      if (pending) {
        sessionStorage.removeItem("pendingDepMap");
        // Only apply if the dep map exists in the available list (or we don't have the list yet)
        if (!listData || listData.available.includes(pending) || listData.available.length === 0) {
          setName(pending);
          return;
        }
      }
    } catch {
      // sessionStorage might be unavailable
    }
    if (!name && listData?.available?.length) {
      setName(listData.available[0]);
    }
  }, [listData, name]);

  // Record viewed dep map to the recent list (server-side, shared)
  React.useEffect(() => {
    if (!name) return;
    fetch(`/api/player-preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action: "addRecentDepMap", debugname: name }),
    }).then(() => reloadRecent()).catch(() => {});
  }, [name, reloadRecent]);

  // Clear selection when name changes
  React.useEffect(() => {
    setSelected(null);
  }, [name]);

  const selectedNode = React.useMemo(() => {
    if (!selected || !depMap) return null;
    return depMap.nodes[selected] || null;
  }, [selected, depMap]);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* ---------- Header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Dependency graph
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-600">
            Interactive radial view of the dep map produced by the tracer. Root NPC
            sits in the center, dependencies radiate outward by BFS depth. Click a node
            to inspect its edges; hover for a tooltip.
          </p>
        </div>
      </div>

      {/* ---------- Dep map selector ---------- */}
      <SectionHeader
        icon={<GitBranch className="size-4" />}
        title="Dep map"
        accent="rose"
        right={
          <Button
            size="sm"
            variant="outline"
            onClick={reload}
            className="gap-1.5"
            disabled={!name}
          >
            <RotateCw className="size-3.5" />
            Reload
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        {listLoading && !listData ? (
          <ShimmerSkeleton className="h-9 w-64" />
        ) : listData && listData.available.length > 0 ? (
          name ? (
            <Select value={name} onValueChange={setName}>
              <SelectTrigger className="h-9 w-[300px] max-w-full border-neutral-200 font-mono text-xs">
                <SelectValue placeholder="Select a dep map…" />
              </SelectTrigger>
              <SelectContent>
                {listData.available.map((n) => (
                  <SelectItem key={n} value={n} className="font-mono text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <ShimmerSkeleton className="h-9 w-[300px] max-w-full" />
          )
        ) : (
          <span className="text-xs text-neutral-500">No dep maps available.</span>
        )}

        {depMap && (
          <GraphStats
            nodes={Object.keys(depMap.nodes).length}
            missing={depMap.missing.length}
            cycles={depMap.cycles.length}
          />
        )}

        {depMap?._demo && (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-[10px] text-amber-700"
          >
            <Info className="mr-1 size-3" />
            synthesized demo
          </Badge>
        )}
      </div>

      {/* ---------- Recently viewed dep maps ---------- */}
      {recentData && recentData.recent.length > 0 && (
        <RecentDepMaps
          recent={recentData.recent}
          currentName={name}
          onSelect={setName}
        />
      )}

      {/* ---------- Search bar ---------- */}
      {depMap && (
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            type="text"
            placeholder="Search nodes by name or kind:id…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 border-neutral-200 bg-white pl-8 pr-8 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ---------- Graph + details panel ---------- */}
      {error ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Failed to load dep map"
          description={error}
        />
      ) : mapLoading && !depMap ? (
        <Card className="border-neutral-200/80 shadow-sm">
          <CardContent className="space-y-3 py-4">
            <ShimmerSkeleton className="h-3 w-1/4" />
            <ShimmerSkeleton className="mx-auto h-96 w-3/4" />
          </CardContent>
        </Card>
      ) : depMap ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          <motion.div variants={staggerItem} className="min-w-0">
            <Card className="overflow-hidden border-neutral-200/80 shadow-sm">
              <CardHeader className="border-b border-neutral-200 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="font-mono text-sm font-semibold text-neutral-900">
                    {depMap.root.kind}:{String(depMap.root.id)}
                    {depMap.root.name && (
                      <span className="ml-2 text-neutral-500">— {depMap.root.name}</span>
                    )}
                  </CardTitle>
                  <GraphLegend />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <DepGraphSvg
                  depMap={depMap}
                  selectedKey={selected}
                  onSelectNode={setSelected}
                  hoveredKey={hovered}
                  onHoverNode={setHovered}
                  searchQuery={searchQuery}
                />
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={staggerItem} className="min-w-0">
            <NodeDetailsPanel node={selectedNode} allNodes={depMap.nodes} />
          </motion.div>
        </div>
      ) : (
        <EmptyState
          icon={<Box className="size-6" />}
          title="No dep map selected"
          description="Pick a dep map from the dropdown above to see its graph."
        />
      )}

      {/* ---------- Edit history timeline ---------- */}
      <EditHistoryTimeline />
    </motion.div>
  );
}
