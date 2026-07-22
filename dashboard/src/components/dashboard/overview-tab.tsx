"use client";

import * as React from "react";
import {
  Box,
  GitBranch,
  Package,
  FileCode2,
  Boxes,
  Link2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ScrollText,
  Layers,
  Cpu,
  Database,
  Workflow,
  Zap,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  ACCENT_BG,
  ACCENT_GRADIENT_FADE,
  ACCENT_HEX,
  ACCENT_RING,
  ACCENT_TEXT,
  CountUp,
  EmptyState,
  SectionHeader,
  ShimmerSkeleton,
  staggerContainer,
  staggerItem,
} from "./primitives";
import { usePipelineStatus, usePlayerPreferences } from "./hooks";
import { usePlayerId } from "./player-context";
import { StatisticsCard } from "./statistics-card";
import { NpcComparisonModal } from "./npc-comparison-modal";
import type {
  AccentColor,
  DepsSummary,
  EraPresetId,
  PilotResult,
  StageInfo,
  VariantEntry,
} from "./types";

// ---------- Variant resolution helper (mirrors engine logic) ----------
export function eraPresetDefault(
  eraPreset: EraPresetId,
  hasOsrsVariant: boolean,
  legacyNpcId: number
): "legacy377" | "osrs" {
  if (legacyNpcId === -1 && hasOsrsVariant) return "osrs";
  switch (eraPreset) {
    case "allOSRS":
    case "07era":
      return hasOsrsVariant ? "osrs" : "legacy377";
    case "05era":
    case "mixed":
    default:
      return "legacy377";
  }
}

// ---------- Stage accent colors ----------
const STAGE_ACCENT: Record<string, AccentColor> = {
  "1-decode": "amber",
  "2-trace": "rose",
  "3-pack": "emerald",
  "4-write": "orange",
  "5-register": "teal",
  "6-pilot": "lime",
};

const STAGE_ICON: Record<string, React.ReactNode> = {
  "1-decode": <FileCode2 className="size-5" />,
  "2-trace": <GitBranch className="size-5" />,
  "3-pack": <Package className="size-5" />,
  "4-write": <Boxes className="size-5" />,
  "5-register": <Database className="size-5" />,
  "6-pilot": <Zap className="size-5" />,
};

const PRIORITY_STYLE: Record<string, { label: string; className: string; accent: AccentColor }> = {
  blocking: { label: "Blocking", className: "bg-red-100 text-red-700 border-red-200", accent: "rose" },
  high: { label: "High", className: "bg-orange-100 text-orange-700 border-orange-200", accent: "orange" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700 border-amber-200", accent: "amber" },
  low: { label: "Low", className: "bg-neutral-100 text-neutral-600 border-neutral-200", accent: "neutral" },
};

// ---------- StatCard with count-up ----------
function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  accent: AccentColor;
}) {
  const isNumber = typeof value === "number";
  return (
    <motion.div variants={staggerItem}>
      <Card className="group overflow-hidden border-neutral-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardDescription className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {label}
            </CardDescription>
            <span
              className={`flex size-7 items-center justify-center rounded-md ring-1 ${ACCENT_BG[accent]} ${ACCENT_TEXT[accent]} ${ACCENT_RING[accent]}`}
            >
              {icon}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="font-mono text-3xl font-semibold tracking-tight text-neutral-900">
            {isNumber ? <CountUp value={value} /> : value}
          </div>
          {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------- StageCard ----------
function StageCard({ stage, index }: { stage: StageInfo; index: number }) {
  const accent = STAGE_ACCENT[stage.id] || "neutral";
  return (
    <motion.div variants={staggerItem} className="h-full">
      <Card className="flex h-full flex-col border-neutral-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${ACCENT_BG[accent]} ${ACCENT_TEXT[accent]} ${ACCENT_RING[accent]}`}
              >
                {STAGE_ICON[stage.id]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium text-neutral-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <CardTitle className="truncate text-base font-semibold text-neutral-900">
                    {stage.name}
                  </CardTitle>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700"
                  >
                    <CheckCircle2 className="mr-1 size-3" />
                    {stage.status}
                  </Badge>
                  <span className="font-mono text-xs text-neutral-500">
                    {stage.files.length} files · {stage.totalLines.toLocaleString()} lines
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 pb-3">
          <p className="text-sm leading-relaxed text-neutral-600">{stage.description}</p>
        </CardContent>
        <CardFooter className="mt-auto flex-col items-start gap-2 border-t bg-neutral-50/60 px-6 py-3">
          <div className="flex w-full items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Files
            </span>
            <span className="font-mono text-[10px] text-neutral-400">
              {stage.files.length} total
            </span>
          </div>
          <div className="max-h-28 w-full overflow-y-auto pr-1 text-xs">
            <ul className="space-y-1">
              {stage.files.map((f) => (
                <li
                  key={f.path}
                  className="flex min-w-0 items-center justify-between gap-2 font-mono text-[11px] leading-tight"
                >
                  <span className="truncate text-neutral-700" title={f.path}>
                    {f.path.replace(/^engine\//, "")}
                  </span>
                  <span className="shrink-0 text-neutral-400">{f.lines}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

// ---------- PilotCard ----------
function PilotCard({ pilot }: { pilot: PilotResult }) {
  const passRate =
    pilot.assertionsTotal > 0
      ? Math.round((pilot.assertionsPassed / pilot.assertionsTotal) * 100)
      : 0;
  const isKQ = pilot.name.includes("Kalphite");
  const accent: AccentColor = isKQ ? "rose" : "amber";
  return (
    <motion.div variants={staggerItem} className="h-full">
      <Card className="flex h-full flex-col border-neutral-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${ACCENT_BG[accent]} ${ACCENT_TEXT[accent]} ${ACCENT_RING[accent]}`}
              >
                <Zap className="size-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-base font-semibold text-neutral-900">
                  {pilot.name}
                </CardTitle>
                <CardDescription className="truncate font-mono text-xs">
                  {pilot.npcName}
                </CardDescription>
              </div>
            </div>
            <Badge className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="mr-1 size-3" />
              PASS
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-600">Assertions</span>
              <span className="font-mono text-neutral-700">
                <CountUp value={pilot.assertionsPassed} /> / <CountUp value={pilot.assertionsTotal} /> ({passRate}%)
              </span>
            </div>
            <Progress value={passRate} className="h-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Nodes traced", value: pilot.nodesTraced },
              { label: "Files written", value: pilot.filesWritten },
              { label: "Pack entries", value: pilot.packEntriesAdded },
              { label: "Variants", value: pilot.variantsRegistered },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2"
              >
                <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  {s.label}
                </div>
                <div className="font-mono text-lg font-semibold text-neutral-900">
                  <CountUp value={s.value} />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border-l-2 border-emerald-300 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
            {pilot.notes}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------- DepsCard ----------
function DepsCard({ dep }: { dep: DepsSummary }) {
  const kinds = Object.entries(dep.nodeKinds).sort((a, b) => b[1] - a[1]);
  const maxKind = Math.max(...kinds.map(([, n]) => n), 1);
  return (
    <motion.div variants={staggerItem} className="h-full">
      <Card className="flex h-full flex-col border-neutral-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="truncate font-mono text-sm font-semibold text-neutral-900">
              {dep.rootName}
            </CardTitle>
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              <CountUp value={dep.nodeCount} /> nodes
            </Badge>
          </div>
          <CardDescription className="truncate font-mono text-[10px] text-neutral-500">
            {dep.path}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 space-y-3">
          <div className="space-y-1.5">
            {kinds.map(([kind, count]) => (
              <div key={kind} className="flex items-center gap-2">
                <span className="w-20 shrink-0 font-mono text-[11px] text-neutral-600">
                  {kind}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: kindColorHex(kind) }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / maxKind) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] text-neutral-700">
                  {count}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-neutral-600">
              <AlertTriangle className="size-3.5 text-amber-500" />
              <span className="font-mono">{dep.missingCount}</span> missing
            </span>
            <span className="flex items-center gap-1 text-neutral-600">
              <GitBranch className="size-3.5 text-rose-500" />
              <span className="font-mono">{dep.cycleCount}</span> cycles
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function kindColorHex(kind: string): string {
  const map: Record<string, AccentColor> = {
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
  return ACCENT_HEX[map[kind] || "neutral"];
}

// ---------- Variants table ----------
function VariantsTable({
  variants,
  linkages,
}: {
  variants: VariantEntry[];
  linkages: [number, number][];
}) {
  if (variants.length === 0) {
    return (
      <EmptyState
        icon={<Database className="size-6" />}
        title="No variants registered yet"
        description={
          <>
            Run an import to populate the variant registry. The CLI walks the OSRS cache,
            transforms each asset to 377-compatible bytes, and writes the result to the
            LostCity content folder.
          </>
        }
        cta={
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-[11px] text-neutral-600">
            bun tools/osrs/Import.ts --osrs-cache=&lt;dir&gt; --npc=&lt;id&gt;
          </div>
        }
      />
    );
  }
  return (
    <Card className="overflow-hidden border-neutral-200/80 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Registered Variants</CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              <Link2 className="mr-1 size-3" />
              {linkages.length} linkages
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {variants.length} entries
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-2">OSRS Debugname</th>
                <th className="px-4 py-2">OSRS ID</th>
                <th className="px-4 py-2">Legacy ID</th>
                <th className="px-4 py-2">Legacy Debugname</th>
                <th className="px-4 py-2">Imported</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr
                  key={i}
                  className="border-b border-neutral-100 transition-colors last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-4 py-2 font-mono text-xs text-neutral-900">
                    {v.osrsDebugname}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-700">
                    {v.osrsNpcId}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {v.legacyNpcId === -1 ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <span className="text-neutral-700">{v.legacyNpcId}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-500">
                    {v.legacyDebugname || "(none)"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-neutral-400">
                    {v.importedAt ? new Date(v.importedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Next steps ----------
function NextSteps({
  steps,
}: {
  steps: { title: string; detail: string; priority: "blocking" | "high" | "medium" | "low" }[];
}) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-3"
    >
      {steps.map((step, i) => {
        const style = PRIORITY_STYLE[step.priority];
        return (
          <motion.div key={i} variants={staggerItem}>
            <Card className="border-neutral-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-mono text-xs font-semibold text-neutral-600">
                  {i + 1}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-neutral-900">{step.title}</h4>
                    <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                      {style.label}
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-neutral-600">{step.detail}</p>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-neutral-300" />
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ---------- Task ID strip ----------
function TaskIdStrip({ taskIds }: { taskIds: string[] }) {
  if (taskIds.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        Tasks:
      </span>
      {taskIds.map((id) => (
        <TooltipProvider key={id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="border-neutral-200 bg-neutral-50 px-1.5 py-0 font-mono text-[10px] text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                {id}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="font-mono text-xs">
              Task ID {id} — see worklog.md
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

// ---------- Live resolution mini-card (NEW) ----------
function LiveResolutionCard() {
  const { playerId } = usePlayerId();
  const { data: pref, loading } = usePlayerPreferences(playerId, 10000);
  if (loading && !pref) {
    return (
      <Card className="border-neutral-200/80 shadow-sm">
        <CardContent className="space-y-3 py-4">
          <ShimmerSkeleton className="h-3 w-1/2" />
          <ShimmerSkeleton className="h-6 w-2/3" />
          <ShimmerSkeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!pref) return null;

  const total = pref.resolutions.length || 1;
  const osrs = pref.summary.osrsResolved;
  const legacy = pref.summary.legacyResolved;
  const osrsPct = (osrs / total) * 100;
  const legacyPct = (legacy / total) * 100;
  const presetLabel =
    pref.eraPreset === "05era"
      ? "2005 era"
      : pref.eraPreset === "07era"
      ? "2007 era"
      : pref.eraPreset === "allOSRS"
      ? "All OSRS"
      : "Mixed / custom";

  return (
    <Card className="relative overflow-hidden border-neutral-200/80 shadow-sm">
      <div
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r"
        style={{
          backgroundImage: `linear-gradient(to right, ${ACCENT_HEX.emerald}, ${ACCENT_HEX.amber})`,
        }}
      />
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-600" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Live resolution · player {playerId}
            </span>
          </div>
          <Badge
            variant="outline"
            className="border-neutral-200 bg-neutral-50 font-mono text-[10px] text-neutral-700"
          >
            {pref.eraPreset}
          </Badge>
        </div>
        <div className="text-sm font-semibold text-neutral-900">{presetLabel}</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
              OSRS models
            </div>
            <div className="font-mono text-lg font-semibold text-emerald-800">
              <CountUp value={osrs} />
            </div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
              Legacy 377
            </div>
            <div className="font-mono text-lg font-semibold text-amber-800">
              <CountUp value={legacy} />
            </div>
          </div>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
          <motion.div
            className="h-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${osrsPct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
          <motion.div
            className="h-full bg-amber-500"
            initial={{ width: 0 }}
            animate={{ width: `${legacyPct}%` }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
          />
        </div>
        {pref.summary.totalOverrides > 0 && (
          <div className="text-[10px] text-neutral-500">
            <span className="font-mono">{pref.summary.totalOverrides}</span> per-NPC overrides applied
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Overview tab ----------
export function OverviewTab() {
  const { data, error, loading } = usePipelineStatus();
  const [compareOpen, setCompareOpen] = React.useState(false);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-10"
    >
      {/* ---------- Hero summary ---------- */}
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Pipeline status
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-600">
              Patches the LostCity 377-branch engine + Java client to handle newer OSRS models,
              with backwards compatibility preserved and a per-player variant selector.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {data && <TaskIdStrip taskIds={data.taskIds} />}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <motion.div variants={staggerItem} className="lg:col-span-1">
            <LiveResolutionCard />
          </motion.div>
          {data && (
            <motion.div
              variants={staggerItem}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-5"
            >
              <StatCard
                label="Stages"
                value={`${data.summary.completedStages}/${data.summary.totalStages}`}
                sub="all complete"
                icon={<Layers className="size-4 text-emerald-600" />}
                accent="emerald"
              />
              <StatCard
                label="Files"
                value={data.summary.totalFiles}
                sub="new TS files"
                icon={<FileCode2 className="size-4 text-amber-600" />}
                accent="amber"
              />
              <StatCard
                label="Lines"
                value={data.summary.totalLines}
                sub="of new code"
                icon={<ScrollText className="size-4 text-rose-600" />}
                accent="rose"
              />
              <StatCard
                label="Variants"
                value={data.summary.totalVariants}
                sub={`${data.summary.totalLinkages} linked groups`}
                icon={<Database className="size-4 text-teal-600" />}
                accent="teal"
              />
              <StatCard
                label="Dep nodes"
                value={data.summary.totalNodesTraced}
                sub={`${data.summary.totalDepsMaps} dep maps`}
                icon={<GitBranch className="size-4 text-orange-600" />}
                accent="orange"
              />
            </motion.div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            <AlertTriangle className="mr-1.5 inline size-3.5" />
            {error}
          </div>
        )}
      </section>

      {/* ---------- Pipeline stages ---------- */}
      <section>
        <SectionHeader
          icon={<Workflow className="size-4" />}
          title="Pipeline stages"
          accent="amber"
        />
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-72 border-neutral-200/80">
                <CardHeader>
                  <ShimmerSkeleton className="h-4 w-1/3" />
                  <ShimmerSkeleton className="mt-2 h-3 w-1/2" />
                </CardHeader>
                <CardContent>
                  <ShimmerSkeleton className="h-3 w-full" />
                  <ShimmerSkeleton className="mt-2 h-3 w-5/6" />
                  <ShimmerSkeleton className="mt-2 h-3 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : data ? (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {data.stages.map((stage, i) => (
              <StageCard key={stage.id} stage={stage} index={i} />
            ))}
          </motion.div>
        ) : null}
      </section>

      {/* ---------- Pilot results ---------- */}
      <section>
        <SectionHeader
          icon={<Zap className="size-4" />}
          title="End-to-end pilots"
          accent="rose"
        />
        {data && data.pilots.length > 0 ? (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2"
          >
            {data.pilots.map((p, i) => (
              <PilotCard key={i} pilot={p} />
            ))}
          </motion.div>
        ) : (
          <EmptyState
            icon={<Zap className="size-6" />}
            title="No pilot runs recorded yet"
            description="Once you run an import, the worklog will record the PILOT PASS line and this section will populate."
          />
        )}
      </section>

      {/* ---------- Dependency maps ---------- */}
      <section>
        <SectionHeader
          icon={<GitBranch className="size-4" />}
          title="Dependency maps"
          accent="orange"
          hint={
            <span>the &ldquo;map&rdquo; the user asked for — recorded while tracing</span>
          }
        />
        {data && data.depsSummaries.length > 0 ? (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {data.depsSummaries.map((d, i) => (
              <DepsCard key={i} dep={d} />
            ))}
          </motion.div>
        ) : (
          <EmptyState
            icon={<Box className="size-6" />}
            title="No deps.json files yet"
            description={
              <>
                No <code className="font-mono text-xs">content/deps/*.deps.json</code> files found.
                Run a pilot to generate the dependency map for an NPC.
              </>
            }
          />
        )}
      </section>

      {/* ---------- Variants registry ---------- */}
      <section>
        <SectionHeader
          icon={<Database className="size-4" />}
          title="Variant registry"
          accent="teal"
        />
        {data && <VariantsTable variants={data.variants} linkages={data.linkages} />}
      </section>

      {/* ---------- Statistics ---------- */}
      <section>
        <StatisticsCard onOpenComparison={() => setCompareOpen(true)} />
      </section>

      {/* ---------- Next steps ---------- */}
      <section>
        <SectionHeader
          icon={<ArrowRight className="size-4" />}
          title="Next steps"
          accent="lime"
        />
        {data && <NextSteps steps={data.nextSteps} />}
      </section>

      {/* ---------- NPC comparison modal ---------- */}
      <NpcComparisonModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />
    </motion.div>
  );
}
