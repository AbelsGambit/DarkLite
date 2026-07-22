"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Users,
  Star,
  GitCompare,
  Clock,
  Database,
  TrendingUp,
  Layers,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CountUp,
  SectionHeader,
  staggerContainer,
  staggerItem,
} from "./primitives";
import { useVariants, usePlayerList } from "./hooks";
import type { NpcComparisonModalProps } from "./npc-comparison-modal";

export function StatisticsCard({
  onOpenComparison,
}: {
  onOpenComparison: () => void;
}) {
  const { data: variantsData } = useVariants();
  const { data: playerList } = usePlayerList();

  if (!variantsData) return null;

  const s = variantsData.summary;
  const totalPlayers = playerList?.players.length ?? 0;
  const totalOverrides = playerList?.players.reduce((sum, p) => sum + p.totalOverrides, 0) ?? 0;
  const totalFavorites = playerList?.players.reduce((sum, p) => sum + (p.favoritesCount ?? 0), 0) ?? 0;

  // Era preset distribution
  const eraCounts = new Map<string, number>();
  for (const p of playerList?.players ?? []) {
    eraCounts.set(p.eraPreset, (eraCounts.get(p.eraPreset) ?? 0) + 1);
  }
  const eraEntries = Array.from(eraCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxEraCount = Math.max(...eraEntries.map(([, c]) => c), 1);

  // Category distribution
  const catCounts = new Map<string, number>();
  catCounts.set("new", s.newCount);
  catCounts.set("upgrade", s.upgradeCount);
  catCounts.set("boss", s.bossCount);
  const catEntries = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxCatCount = Math.max(...catEntries.map(([, c]) => c), 1);

  const ERA_LABELS: Record<string, string> = {
    "05era": "2005 era",
    "07era": "2007 era",
    allOSRS: "All OSRS",
    mixed: "Mixed",
  };
  const ERA_COLORS: Record<string, string> = {
    "05era": "#f59e0b",
    "07era": "#f43f5e",
    allOSRS: "#10b981",
    mixed: "#14b8a6",
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      <SectionHeader
        icon={<BarChart3 className="size-4" />}
        title="Statistics"
        accent="purple"
        right={
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenComparison}
            className="gap-1.5"
          >
            <GitCompare className="size-3.5" />
            Compare NPCs
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Aggregate stats */}
        <motion.div variants={staggerItem}>
          <Card className="h-full border-neutral-200/80 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="size-4 text-purple-600" />
                Aggregate
              </CardTitle>
              <CardDescription className="text-xs">
                Across all players + all registered variants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  icon={<Users className="size-3.5" />}
                  label="Players"
                  value={totalPlayers}
                  color="text-teal-600"
                />
                <Stat
                  icon={<Database className="size-3.5" />}
                  label="Variants"
                  value={s.totalVariants}
                  color="text-emerald-600"
                />
                <Stat
                  icon={<Layers className="size-3.5" />}
                  label="Regions"
                  value={s.regionCount}
                  color="text-amber-600"
                />
                <Stat
                  icon={<TrendingUp className="size-3.5" />}
                  label="Overrides"
                  value={totalOverrides}
                  color="text-rose-600"
                />
                <Stat
                  icon={<Star className="size-3.5" />}
                  label="Favorites"
                  value={totalFavorites}
                  color="text-amber-600"
                />
                <Stat
                  icon={<GitCompare className="size-3.5" />}
                  label="Linkages"
                  value={s.totalLinkages}
                  color="text-orange-600"
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Era preset distribution */}
        <motion.div variants={staggerItem}>
          <Card className="h-full border-neutral-200/80 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4 text-teal-600" />
                Era preset distribution
              </CardTitle>
              <CardDescription className="text-xs">
                Which preset each player is using
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {eraEntries.length === 0 ? (
                <p className="py-4 text-center text-xs text-neutral-400">No players yet</p>
              ) : (
                eraEntries.map(([era, count]) => (
                  <div key={era} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      {ERA_LABELS[era] ?? era}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: ERA_COLORS[era] ?? "#737373" }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / maxEraCount) * 100}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {count}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Category distribution */}
        <motion.div variants={staggerItem}>
          <Card className="h-full border-neutral-200/80 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-amber-600" />
                Variant categories
              </CardTitle>
              <CardDescription className="text-xs">
                Breakdown of imported NPC types
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {catEntries.map(([cat, count]) => {
                const label = cat === "new" ? "New (OSRS-only)" : cat === "boss" ? "Boss" : "Upgrade";
                const color = cat === "new" ? "#a855f7" : cat === "boss" ? "#f43f5e" : "#14b8a6";
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      {label}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / maxCatCount) * 100}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {count}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick actions */}
        <motion.div variants={staggerItem}>
          <Card className="h-full border-neutral-200/80 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-rose-600" />
                Quick actions
              </CardTitle>
              <CardDescription className="text-xs">
                Jump to common tasks
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={onOpenComparison}
              >
                <GitCompare className="size-3.5" />
                Compare two NPCs&apos; dep maps
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 text-xs"
                    onClick={() => {
                      const ev = new KeyboardEvent("keydown", { key: "?", bubbles: true });
                      window.dispatchEvent(ev);
                    }}
                  >
                    <Layers className="size-3.5" />
                    Show keyboard shortcuts
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Opens the shortcuts overlay
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Stat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${color}`}>
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <CountUp value={value} />
      </div>
    </div>
  );
}
