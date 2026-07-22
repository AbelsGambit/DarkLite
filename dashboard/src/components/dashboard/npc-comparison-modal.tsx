"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  GitBranch,
  ArrowRight,
  Check,
  Minus,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDepsList, useDepsMap } from "./hooks";
import type { DepsMap, DepNode } from "./types";

export type NpcComparisonModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNameA?: string | null;
  initialNameB?: string | null;
};

type NodeKey = string;

export function NpcComparisonModal({
  open,
  onOpenChange,
  initialNameA,
  initialNameB,
}: NpcComparisonModalProps) {
  const { data: listData } = useDepsList();
  const [nameA, setNameA] = React.useState<string | null>(initialNameA ?? null);
  const [nameB, setNameB] = React.useState<string | null>(initialNameB ?? null);

  // Sync initial names when opened
  React.useEffect(() => {
    if (open) {
      if (initialNameA) setNameA(initialNameA);
      if (initialNameB) setNameB(initialNameB);
      else if (!nameB && listData?.available?.length) {
        // Pick a different one than A
        const other = listData.available.find((n) => n !== (initialNameA ?? nameA));
        if (other) setNameB(other);
      }
    }
  }, [open, initialNameA, initialNameB, listData, nameA, nameB]);

  const { data: mapA } = useDepsMap(nameA);
  const { data: mapB } = useDepsMap(nameB);

  // Esc to close
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  // Compute the diff
  const diff = React.useMemo(() => {
    if (!mapA || !mapB) return null;
    const keysA = new Set<NodeKey>(Object.keys(mapA.nodes));
    const keysB = new Set<NodeKey>(Object.keys(mapB.nodes));
    const allKeys = new Set<NodeKey>([...keysA, ...keysB]);

    const shared: NodeKey[] = [];
    const onlyA: NodeKey[] = [];
    const onlyB: NodeKey[] = [];

    for (const k of allKeys) {
      if (keysA.has(k) && keysB.has(k)) shared.push(k);
      else if (keysA.has(k)) onlyA.push(k);
      else onlyB.push(k);
    }

    // For shared nodes, compare their deps
    const sharedWithDiffs: { key: NodeKey; node: DepNode; depsA: number; depsB: number; same: boolean }[] = [];
    for (const k of shared) {
      const nodeA = mapA.nodes[k];
      const nodeB = mapB.nodes[k];
      const depsA = nodeA.deps.length;
      const depsB = nodeB.deps.length;
      // Compare dep sets
      const setA = new Set(nodeA.deps.map((d) => `${d.kind}:${d.id}`));
      const setB = new Set(nodeB.deps.map((d) => `${d.kind}:${d.id}`));
      const same = setA.size === setB.size && [...setA].every((d) => setB.has(d));
      sharedWithDiffs.push({ key: k, node: nodeA, depsA, depsB, same });
    }

    return {
      shared: shared.sort(),
      onlyA: onlyA.sort(),
      onlyB: onlyB.sort(),
      sharedWithDiffs: sharedWithDiffs.sort((a, b) => a.key.localeCompare(b.key)),
      totalA: keysA.size,
      totalB: keysB.size,
    };
  }, [mapA, mapB]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-neutral-900/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="fixed left-1/2 top-[8%] z-[60] flex h-[84vh] w-full max-w-5xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-label="NPC comparison"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800">
                  <GitBranch className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Compare dep maps
                  </h2>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Side-by-side diff of two NPCs&apos; dependency graphs
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="size-8 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Close comparison"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Selectors */}
            <div className="grid grid-cols-1 gap-3 border-b border-neutral-200 px-5 py-3 sm:grid-cols-2 dark:border-neutral-700">
              <DepMapPicker
                label="NPC A"
                value={nameA}
                onChange={setNameA}
                available={listData?.available ?? []}
                accent="amber"
              />
              <DepMapPicker
                label="NPC B"
                value={nameB}
                onChange={setNameB}
                available={listData?.available ?? []}
                accent="rose"
              />
            </div>

            {/* Body */}
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-5">
                {!diff ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <Boxes className="size-8 text-neutral-300 dark:text-neutral-600" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      Select two dep maps to compare
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <SummaryStat label="NPC A nodes" value={diff.totalA} accent="amber" />
                      <SummaryStat label="NPC B nodes" value={diff.totalB} accent="rose" />
                      <SummaryStat label="Shared" value={diff.shared.length} accent="emerald" />
                      <SummaryStat
                        label="Unique (A + B)"
                        value={diff.onlyA.length + diff.onlyB.length}
                        accent="purple"
                      />
                    </div>

                    {/* Venn-style summary */}
                    <Card className="border-neutral-200/80 dark:border-neutral-700 dark:bg-neutral-900">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                          Dependency overlap
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            A only: {diff.onlyA.length}
                          </Badge>
                          <ArrowRight className="size-3 text-neutral-400" />
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Shared: {diff.shared.length}
                          </Badge>
                          <ArrowRight className="size-3 text-neutral-400" />
                          <Badge className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                            B only: {diff.onlyB.length}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Shared nodes (with diff indicators) */}
                    {diff.shared.length > 0 && (
                      <DiffSection
                        title="Shared dependencies"
                        count={diff.shared.length}
                        icon={<Check className="size-3.5 text-emerald-600" />}
                        accent="emerald"
                      >
                        <div className="space-y-1">
                          {diff.sharedWithDiffs.map(({ key, node, depsA, depsB, same }) => (
                            <div
                              key={key}
                              className="flex items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800/50"
                            >
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: kindColor(node.kind) }}
                              />
                              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                                {node.name || key}
                              </code>
                              {same ? (
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[9px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  <Check className="mr-0.5 size-2.5" />
                                  identical
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[9px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  <AlertTriangle className="mr-0.5 size-2.5" />
                                  {depsA}→{depsB} deps
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </DiffSection>
                    )}

                    {/* Only A + Only B side by side */}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <DiffSection
                        title="Only in A"
                        count={diff.onlyA.length}
                        icon={<Minus className="size-3.5 text-amber-600" />}
                        accent="amber"
                      >
                        <NodeList keys={diff.onlyA} map={mapA} />
                      </DiffSection>
                      <DiffSection
                        title="Only in B"
                        count={diff.onlyB.length}
                        icon={<Minus className="size-3.5 text-rose-600" />}
                        accent="rose"
                      >
                        <NodeList keys={diff.onlyB} map={mapB} />
                      </DiffSection>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="border-t border-neutral-200 px-5 py-2 dark:border-neutral-700">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>
                  Press <kbd className="rounded border border-neutral-300 bg-white px-1 font-mono dark:border-neutral-600 dark:bg-neutral-800">Esc</kbd> to close
                </span>
                <span className="font-mono">
                  {diff ? `${diff.shared.length + diff.onlyA.length + diff.onlyB.length} total unique nodes` : ""}
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DepMapPicker({
  label,
  value,
  onChange,
  available,
  accent,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  available: string[];
  accent: "amber" | "rose";
}) {
  const accentClass = accent === "amber"
    ? "text-amber-700 dark:text-amber-300"
    : "text-rose-700 dark:text-rose-300";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-semibold ${accentClass}`}>{label}</span>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 flex-1 border-neutral-200 bg-white font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
          <SelectValue placeholder="Select dep map…" />
        </SelectTrigger>
        <SelectContent>
          {available.map((n) => (
            <SelectItem key={n} value={n} className="font-mono text-xs">
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "amber" | "rose" | "emerald" | "purple";
}) {
  const colors = {
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
    rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
    purple: "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200",
  };
  return (
    <div className={`rounded-md border px-3 py-2 text-center ${colors[accent]}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function DiffSection({
  title,
  count,
  icon,
  accent,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  accent: "emerald" | "amber" | "rose";
  children: React.ReactNode;
}) {
  const borderClass = {
    emerald: "border-emerald-200 dark:border-emerald-800",
    amber: "border-amber-200 dark:border-amber-800",
    rose: "border-rose-200 dark:border-rose-800",
  }[accent];
  return (
    <Card className={`border ${borderClass} dark:bg-neutral-900`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {icon}
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              {title}
            </CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">
            {count}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {count === 0 ? (
          <p className="py-2 text-center text-[11px] text-neutral-400">None</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function NodeList({ keys, map }: { keys: string[]; map: DepsMap | null }) {
  if (!map) return null;
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto">
      {keys.map((k) => {
        const node = map.nodes[k];
        if (!node) return null;
        return (
          <div
            key={k}
            className="flex items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800/50"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: kindColor(node.kind) }}
            />
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
              {node.name || k}
            </code>
            {node.missing && (
              <AlertTriangle className="size-3 shrink-0 text-red-500" />
            )}
          </div>
        );
      })}
    </div>
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
