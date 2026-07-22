"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Undo2,
  Clock,
  ArrowRight,
  X,
  Database,
  MapPin,
  SlidersHorizontal,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import { usePlayerId } from "./player-context";
import { usePlayerPreferences } from "./hooks";

type HistoryEntry = {
  id: string;
  playerId: number;
  timestamp: string;
  action: string;
  description: string;
  before: {
    eraPreset: string;
    npcOverrides: Record<string, string>;
    regionOverrides: Record<string, string>;
  };
  after: {
    eraPreset: string;
    npcOverrides: Record<string, string>;
    regionOverrides: Record<string, string>;
  };
};

type HistoryResponse = {
  playerId: number;
  history: HistoryEntry[];
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  setEra: <SlidersHorizontal className="size-3.5" />,
  setNpcOverride: <Database className="size-3.5" />,
  clearNpcOverride: <Database className="size-3.5" />,
  setRegionOverride: <MapPin className="size-3.5" />,
  clearRegionOverride: <MapPin className="size-3.5" />,
  clearAll: <Undo2 className="size-3.5" />,
  replace: <GitBranch className="size-3.5" />,
};

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function EditHistoryTimeline() {
  const { playerId } = usePlayerId();
  const pref = usePlayerPreferences(playerId, 5000);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [undoing, setUndoing] = React.useState(false);

  // Fetch history (poll every 5s to catch new edits)
  const loadHistory = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/player-preferences?action=history&playerId=${playerId}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as HistoryResponse;
      setHistory(data.history);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  React.useEffect(() => {
    setLoading(true);
    loadHistory();
    const t = setInterval(loadHistory, 5000);
    return () => clearInterval(t);
  }, [loadHistory]);

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const r = await fetch(`/api/player-preferences?playerId=${playerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "undo" }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      toast.success("Undo successful", {
        description: history[0]?.description
          ? `Reverted: ${history[0].description}`
          : "Last change reverted",
      });
      await loadHistory();
      await pref.reload();
    } catch (e) {
      toast.error("Undo failed", { description: (e as Error).message });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      <SectionHeader
        icon={<History className="size-4" />}
        title="Edit history"
        accent="purple"
        right={
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUndo}
                  disabled={history.length === 0 || undoing}
                  className="gap-1.5"
                >
                  <Undo2 className={`size-3.5 ${undoing ? "animate-spin" : ""}`} />
                  Undo
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {history.length > 0
                ? `Revert: ${history[0].description}`
                : "No edits to undo"}
            </TooltipContent>
          </Tooltip>
        }
      />

      <Card className="border-neutral-200/80 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Preference timeline
              </CardTitle>
              <CardDescription className="text-xs">
                Recent changes for player {playerId}. In-memory only (resets on server restart).
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              {history.length} {history.length === 1 ? "entry" : "entries"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <ShimmerSkeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="p-3">
              <EmptyState
                icon={<Clock className="size-5" />}
                title="No edits yet"
                description={
                  <>
                    Changes you make to the era preset, per-NPC overrides, or region
                    overrides will appear here as a timeline. Use the Undo button to
                    revert the most recent change.
                  </>
                }
              />
            </div>
          ) : (
            <ScrollArea className="max-h-[420px]">
              <div className="relative p-3">
                {/* Vertical timeline line */}
                <div className="absolute left-[22px] top-3 bottom-3 w-px bg-gradient-to-b from-neutral-200 via-neutral-200 to-transparent dark:from-neutral-700 dark:via-neutral-700" />

                <motion.ol variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
                  {history.map((entry, i) => {
                    const icon = ACTION_ICON[entry.action] || <History className="size-3.5" />;
                    const isLatest = i === 0;
                    return (
                      <motion.li
                        key={entry.id}
                        variants={staggerItem}
                        className="relative flex gap-3"
                      >
                        {/* Timeline dot */}
                        <div
                          className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-neutral-900 ${
                            isLatest
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                          }`}
                        >
                          {icon}
                        </div>

                        {/* Entry body */}
                        <div className="min-w-0 flex-1 pb-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Badge
                              variant="outline"
                              className={`shrink-0 font-mono text-[10px] ${
                                isLatest
                                  ? "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                                  : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                              }`}
                            >
                              {entry.action}
                            </Badge>
                            <span className="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                              {relTime(entry.timestamp)}
                            </span>
                            {isLatest && (
                              <Badge className="shrink-0 bg-purple-100 px-1 py-0 text-[9px] text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                                latest
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
                            {entry.description}
                          </p>
                          {/* Diff line */}
                          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                            <span className="text-amber-600 dark:text-amber-400">
                              {entry.before.eraPreset}
                              {Object.keys(entry.before.npcOverrides).length > 0 && ` +${Object.keys(entry.before.npcOverrides).length}`}
                              {Object.keys(entry.before.regionOverrides).length > 0 && ` +${Object.keys(entry.before.regionOverrides).length}r`}
                            </span>
                            <ArrowRight className="size-3" />
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {entry.after.eraPreset}
                              {Object.keys(entry.after.npcOverrides).length > 0 && ` +${Object.keys(entry.after.npcOverrides).length}`}
                              {Object.keys(entry.after.regionOverrides).length > 0 && ` +${Object.keys(entry.after.regionOverrides).length}r`}
                            </span>
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </motion.ol>
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
