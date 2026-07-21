"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Check,
  Download,
  Filter,
  Gauge,
  Globe,
  Layers,
  Link2,
  Lock,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Undo2,
  Upload,
  X,
  Zap,
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
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ACCENT_BG,
  ACCENT_BG_SOFT,
  ACCENT_BORDER,
  ACCENT_DOT,
  ACCENT_GRADIENT,
  ACCENT_GRADIENT_FADE,
  ACCENT_HEX,
  ACCENT_RING,
  ACCENT_RING_STRONG,
  ACCENT_TEXT,
  CountUp,
  EmptyState,
  SectionHeader,
  ShimmerSkeleton,
  staggerContainer,
  staggerItem,
} from "./primitives";
import { usePlayerPreferences, useVariants } from "./hooks";
import { usePlayerId } from "./player-context";
import { copyShareableUrl, decodePreferencesFromHash } from "@/lib/prefs-sharing";
import { eraPresetDefault } from "./overview-tab";
import { NpcDetailDrawer } from "./npc-detail-drawer";
import { RegionOverrides } from "./region-overrides";
import { BulkActionBar } from "./bulk-action-bar";
import type {
  AccentColor,
  EraPresetId,
  NpcVariant,
  UnifiedVariant,
} from "./types";

// ---------- Era preset icon (one per preset) ----------
const PRESET_ICON: Record<EraPresetId, React.ReactNode> = {
  "05era": <Layers className="size-6" />,
  "07era": <Globe className="size-6" />,
  allOSRS: <Sparkles className="size-6" />,
  mixed: <SlidersHorizontal className="size-6" />,
};

// ---------- Basic mode: era preset card ----------
function EraPresetCard({
  preset,
  isActive,
  onSelect,
}: {
  preset: EraPresetInfoShape;
  isActive: boolean;
  onSelect: (id: EraPresetId) => void;
}) {
  const accent = preset.accent;
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(preset.id)}
      variants={staggerItem}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className={`group relative flex h-full flex-col items-start overflow-hidden rounded-xl border bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md ${
        isActive
          ? `${ACCENT_BORDER[accent]} ring-2 ${ACCENT_RING_STRONG[accent]}`
          : "border-neutral-200/80"
      }`}
    >
      {/* gradient accent strip top */}
      <div
        className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${ACCENT_GRADIENT[accent]}`}
      />
      {/* checkmark when active */}
      {isActive && (
        <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className={`absolute right-3 top-3 flex size-6 items-center justify-center rounded-full ${ACCENT_BG[accent]} ${ACCENT_TEXT[accent]} ring-2 ${ACCENT_RING_STRONG[accent]}`}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </motion.div>
      )}

      <div
        className={`mb-3 flex size-12 items-center justify-center rounded-lg bg-gradient-to-br ${ACCENT_GRADIENT[accent]} ${ACCENT_TEXT[accent]}`}
      >
        {PRESET_ICON[preset.id]}
      </div>

      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-base font-semibold text-neutral-900">{preset.label}</h3>
      </div>
      <p className="mb-2 text-xs font-medium text-neutral-500">{preset.subtitle}</p>
      <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-neutral-600">
        {preset.description}
      </p>

      <div className="mt-auto flex w-full items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={`shrink-0 text-[10px] ${ACCENT_BORDER[accent]} ${ACCENT_BG_SOFT[accent]} ${ACCENT_TEXT[accent]}`}
        >
          {preset.badge}
        </Badge>
        <span className="font-mono text-[10px] text-neutral-400">{preset.yearRange}</span>
      </div>
    </motion.button>
  );
}

type EraPresetInfoShape = {
  id: EraPresetId;
  label: string;
  subtitle: string;
  description: string;
  accent: AccentColor;
  badge: string;
  yearRange: string;
};

// ---------- Live impact preview ----------
function LiveImpactPreview({
  eraPreset,
  variants,
}: {
  eraPreset: EraPresetId;
  variants: UnifiedVariant[];
}) {
  const stats = React.useMemo(() => {
    let osrs = 0;
    let legacy = 0;
    let newOnly = 0;
    for (const v of variants) {
      const isNew = v.legacyNpcId === -1;
      if (isNew && v.hasOsrsVariant) {
        osrs++;
        newOnly++;
        continue;
      }
      const resolved = eraPresetDefault(eraPreset, v.hasOsrsVariant, v.legacyNpcId);
      if (resolved === "osrs") osrs++;
      else legacy++;
    }
    return { osrs, legacy, newOnly };
  }, [eraPreset, variants]);

  const total = stats.osrs + stats.legacy || 1;
  const osrsPct = (stats.osrs / total) * 100;
  const legacyPct = (stats.legacy / total) * 100;

  return (
    <Card className="overflow-hidden border-neutral-200/80 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-neutral-900">
            Live impact preview
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">
            with <span className="ml-1 font-semibold">{eraPreset}</span>
          </Badge>
        </div>
        <CardDescription className="text-xs">
          How NPCs will render in-game with this preset (per-NPC overrides excluded from the count)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
              OSRS
            </div>
            <div className="font-mono text-2xl font-semibold text-emerald-800">
              <CountUp value={stats.osrs} />
            </div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
              Legacy
            </div>
            <div className="font-mono text-2xl font-semibold text-amber-800">
              <CountUp value={stats.legacy} />
            </div>
          </div>
          <div className="rounded-md border border-purple-200 bg-purple-50/60 px-3 py-2 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-purple-700">
              New-only
            </div>
            <div className="font-mono text-2xl font-semibold text-purple-800">
              <CountUp value={stats.newOnly} />
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            <span>Distribution</span>
            <span className="font-mono">{stats.osrs + stats.legacy} NPCs</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
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
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-neutral-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              OSRS model (imported from modern cache)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              Legacy 377 model (original)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-purple-500" />
              New-only (no legacy twin exists)
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Advanced mode: NPC row ----------
type DisplayRow = {
  kind: "variant" | "legacy-only";
  legacyNpcId: number;
  osrsNpcId: number | null;
  displayName: string;
  debugname: string;
  region: string;
  category?: "new" | "upgrade" | "boss";
  hasOsrsVariant: boolean;
  groupKey?: string; // group identifier (osrsNpcId of first member) if linked
  groupSize?: number;
};

function NpcRow({
  row,
  resolved,
  source,
  onToggle,
  onOpenDetails,
  isSelected,
  isFavorite,
  onToggleSelect,
  onToggleFavorite,
}: {
  row: DisplayRow;
  resolved: NpcVariant;
  source: "override" | "era-preset" | "default";
  onToggle: () => void;
  onOpenDetails: () => void;
  isSelected: boolean;
  isFavorite: boolean;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const isOsrs = resolved === "osrs";
  const canToggle = row.hasOsrsVariant && row.legacyNpcId !== -1;

  const categoryBadge =
    row.category === "boss"
      ? { label: "Boss", className: "border-rose-200 bg-rose-50 text-rose-700" }
      : row.category === "new"
      ? { label: "New", className: "border-purple-200 bg-purple-50 text-purple-700" }
      : row.category === "upgrade"
      ? { label: "Upgrade", className: "border-teal-200 bg-teal-50 text-teal-700" }
      : null;

  return (
    <motion.div
      variants={staggerItem}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 transition-all hover:shadow-sm ${
        isSelected
          ? "border-purple-300 bg-purple-50/50 ring-1 ring-purple-200"
          : source === "override"
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
      }`}
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails();
        }
      }}
      aria-label={`Open details for ${row.displayName}`}
    >
      {/* Selection checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
          isSelected
            ? "border-purple-500 bg-purple-500 text-white"
            : "border-neutral-300 bg-white hover:border-purple-400 dark:border-neutral-600 dark:bg-neutral-800"
        }`}
        aria-label={isSelected ? `Deselect ${row.displayName}` : `Select ${row.displayName}`}
        aria-pressed={isSelected}
      >
        {isSelected && <Check className="size-3" strokeWidth={3} />}
      </button>

      {/* Favorite star */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`shrink-0 rounded p-0.5 transition-colors ${
          isFavorite
            ? "text-amber-500 hover:text-amber-600"
            : "text-neutral-300 hover:text-amber-400 dark:text-neutral-600"
        }`}
        aria-label={isFavorite ? `Unfavorite ${row.displayName}` : `Favorite ${row.displayName}`}
        aria-pressed={isFavorite}
      >
        <Star className="size-3.5" fill={isFavorite ? "currentColor" : "none"} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          className={`flex size-2 shrink-0 rounded-full ${
            isOsrs ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-900">
              {row.displayName}
            </span>
            {row.groupSize && row.groupSize > 1 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-orange-200 bg-orange-50 px-1 py-0 text-[9px] font-medium text-orange-700"
                    >
                      <Link2 className="mr-0.5 size-2.5" />
                      {row.groupSize}-linked
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Member of a {row.groupSize}-form linkage group. Toggling one toggles the whole group — forms move together.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {source === "override" && (
              <Badge
                variant="outline"
                className="shrink-0 border-emerald-200 bg-emerald-50 px-1 py-0 text-[9px] font-medium text-emerald-700"
              >
                override
              </Badge>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-neutral-500">{row.debugname}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {categoryBadge && (
          <Badge variant="outline" className={`hidden text-[9px] sm:inline-flex ${categoryBadge.className}`}>
            {categoryBadge.label}
          </Badge>
        )}
        <Badge
          variant="outline"
          className="hidden font-mono text-[9px] text-neutral-500 md:inline-flex"
        >
          {row.region}
        </Badge>

        {canToggle ? (
          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="font-mono text-[9px] font-medium uppercase tracking-wide text-neutral-500">
              377
            </span>
            <Switch
              checked={isOsrs}
              onCheckedChange={onToggle}
              aria-label={`Toggle ${row.displayName} variant`}
              className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-amber-400"
            />
            <span className="font-mono text-[9px] font-medium uppercase tracking-wide text-neutral-500">
              osrs
            </span>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  row.hasOsrsVariant
                    ? "border-purple-200 bg-purple-50 text-purple-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                <Lock className="mr-1 size-2.5" />
                {row.hasOsrsVariant ? "OSRS-only" : "Legacy only"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs">
              {row.hasOsrsVariant
                ? "This NPC has no legacy 377 equivalent — the OSRS model is the only option."
                : "No OSRS variant has been imported for this NPC yet. Run the import pipeline to enable toggling."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </motion.div>
  );
}

// ---------- Advanced mode: filter bar ----------
function FilterBar({
  search,
  onSearch,
  region,
  onRegion,
  category,
  onCategory,
  availability,
  onAvailability,
  regions,
  onReset,
}: {
  search: string;
  onSearch: (v: string) => void;
  region: string;
  onRegion: (v: string) => void;
  category: string;
  onCategory: (v: string) => void;
  availability: string;
  onAvailability: (v: string) => void;
  regions: string[];
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
      <div className="relative min-w-[180px] flex-1">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          type="text"
          placeholder="Search NPC name or debugname…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-8 border-neutral-200 bg-transparent pl-8 text-sm"
        />
      </div>
      <Select value={region} onValueChange={onRegion}>
        <SelectTrigger size="sm" className="h-8 w-[160px] border-neutral-200">
          <SelectValue placeholder="Region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All regions</SelectItem>
          {regions.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={category} onValueChange={onCategory}>
        <SelectTrigger size="sm" className="h-8 w-[155px] border-neutral-200">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="upgrade">Upgrade</SelectItem>
          <SelectItem value="boss">Boss</SelectItem>
        </SelectContent>
      </Select>
      <Select value={availability} onValueChange={onAvailability}>
        <SelectTrigger size="sm" className="h-8 w-[160px] border-neutral-200">
          <SelectValue placeholder="Availability" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All NPCs</SelectItem>
          <SelectItem value="has-osrs">Has OSRS variant</SelectItem>
          <SelectItem value="legacy-only">Legacy only</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        onClick={onReset}
        className="h-8 gap-1.5 text-neutral-600"
      >
        <X className="size-3.5" />
        Clear
      </Button>
    </div>
  );
}

// ---------- Sticky summary bar ----------
function StickySummary({
  eraPreset,
  totalOverrides,
  osrs,
  legacy,
}: {
  eraPreset: EraPresetId;
  totalOverrides: number;
  osrs: number;
  legacy: number;
}) {
  return (
    <div className="sticky top-[105px] z-20 -mx-1 mb-3 rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Gauge className="size-3.5 text-neutral-500" />
          <span className="font-medium text-neutral-700">Current preset:</span>
          <Badge
            variant="outline"
            className="border-neutral-200 bg-neutral-50 font-mono text-[10px]"
          >
            {eraPreset}
          </Badge>
        </div>
        <Separator orientation="vertical" className="hidden h-4 sm:block" />
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-neutral-700">Overrides:</span>
          <span className="font-mono font-semibold text-emerald-700">
            <CountUp value={totalOverrides} />
          </span>
        </div>
        <Separator orientation="vertical" className="hidden h-4 sm:block" />
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="font-mono font-semibold text-emerald-700">{osrs}</span>
          <span className="text-neutral-500">OSRS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" />
          <span className="font-mono font-semibold text-amber-700">{legacy}</span>
          <span className="text-neutral-500">legacy</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Main configuration tab ----------
export function ConfigurationTab() {
  const [mode, setMode] = React.useState<"basic" | "advanced">("basic");
  const { playerId } = usePlayerId();
  const { data: variantsData, loading: variantsLoading } = useVariants();
  const pref = usePlayerPreferences(playerId, 5000);

  const [search, setSearch] = React.useState("");
  const [region, setRegion] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [availability, setAvailability] = React.useState("all");
  const [drawerNpc, setDrawerNpc] = React.useState<UnifiedVariant | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const fileImportRef = React.useRef<HTMLInputElement>(null);

  // ---------- Favorites handler ----------
  const handleToggleFavorite = async (legacyNpcId: number) => {
    try {
      await pref.update({ action: "toggleFavorite", npcId: legacyNpcId });
    } catch (e) {
      toast.error("Failed to toggle favorite", { description: (e as Error).message });
    }
  };

  // ---------- Selection handlers ----------
  const toggleSelect = (legacyNpcId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(legacyNpcId)) next.delete(legacyNpcId);
      else next.add(legacyNpcId);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectAllVisible = (ids: number[]) => setSelectedIds(new Set(ids));

  // ---------- Bulk actions ----------
  const handleBulkSet = async (variant: NpcVariant) => {
    const npcIds = Array.from(selectedIds);
    if (npcIds.length === 0) return;
    try {
      await pref.update({ action: "bulkSetNpcOverride", npcIds, variant });
      clearSelection();
    } catch (e) {
      toast.error("Bulk set failed", { description: (e as Error).message });
    }
  };
  const handleBulkClear = async () => {
    const npcIds = Array.from(selectedIds);
    if (npcIds.length === 0) return;
    try {
      await pref.update({ action: "bulkClearNpcOverride", npcIds });
      clearSelection();
    } catch (e) {
      toast.error("Bulk clear failed", { description: (e as Error).message });
    }
  };

  // ---------- Era preset selection ----------
  const handleSelectPreset = async (id: EraPresetId) => {
    try {
      await pref.update({ action: "setEra", eraPreset: id });
      const label = variantsData?.eraPresets.find((p) => p.id === id)?.label ?? id;
      toast.success("Era preset updated", {
        description: `Player ${playerId} now uses ${label}.`,
      });
    } catch (e) {
      toast.error("Failed to update era preset", { description: (e as Error).message });
    }
  };

  // ---------- NPC toggle ----------
  const handleToggleNpc = async (row: DisplayRow) => {
    if (!pref.data) return;
    if (!row.hasOsrsVariant || row.legacyNpcId === -1) return;

    // Find current resolved variant
    const resolution = pref.data.resolutions.find((r) => r.legacyNpcId === row.legacyNpcId);
    const currentResolved: NpcVariant = resolution?.resolved ?? "legacy377";
    const newVariant: NpcVariant = currentResolved === "osrs" ? "legacy377" : "osrs";

    // Determine linkage group members (if any)
    const groupMembers: DisplayRow[] = [];
    if (row.groupKey && row.groupSize && row.groupSize > 1) {
      // We need to know all rows in the same group. We'll reconstruct from
      // the variants data on demand using the linkageGroups field.
      // For now, we have the row's groupKey (= the osrsNpcId of one member).
      // The full group is in variantsData.linkageGroups.
    }
    // groupMembers is rebuilt below using full row list (computed in render).
    // Since handleToggleNpc doesn't have direct access to that, we re-find
    // from variantsData.
    if (variantsData && row.groupKey) {
      const group = variantsData.linkageGroups.find((g) =>
        g.some((id) => String(id) === row.groupKey)
      );
      if (group && group.length > 1) {
        for (const osrsId of group) {
          const variant = variantsData.variants.find((v) => v.osrsNpcId === osrsId);
          if (variant && variant.legacyNpcId !== -1) {
            groupMembers.push({
              kind: "variant",
              legacyNpcId: variant.legacyNpcId,
              osrsNpcId: variant.osrsNpcId,
              displayName: variant.displayName,
              debugname: variant.osrsDebugname,
              region: variant.region || "Unknown",
              category: variant.category,
              hasOsrsVariant: true,
              groupKey: row.groupKey,
              groupSize: group.length,
            });
          }
        }
      }
    }

    const isGroup = groupMembers.length > 1;
    const defaultForEra = eraPresetDefault(
      pref.data.eraPreset,
      row.hasOsrsVariant,
      row.legacyNpcId
    );

    try {
      if (isGroup) {
        // For each group member: set or clear override
        for (const member of groupMembers) {
          const memberDefault = eraPresetDefault(
            pref.data.eraPreset,
            member.hasOsrsVariant,
            member.legacyNpcId
          );
          if (newVariant === memberDefault) {
            await pref.update({
              action: "clearNpcOverride",
              npcId: member.legacyNpcId,
            });
          } else {
            await pref.update({
              action: "setNpcOverride",
              npcId: member.legacyNpcId,
              variant: newVariant,
            });
          }
        }
        const label = newVariant === "osrs" ? "OSRS" : "legacy 377";
        toast.success(`${row.displayName} (${groupMembers.length} forms) switched to ${label}`, {
          description: "Forms move together — linkage preserved.",
        });
      } else {
        if (newVariant === defaultForEra) {
          await pref.update({ action: "clearNpcOverride", npcId: row.legacyNpcId });
          toast.success(`${row.displayName} reverted to era-preset default`, {
            description: `Override cleared (resolves to ${defaultForEra}).`,
          });
        } else {
          await pref.update({
            action: "setNpcOverride",
            npcId: row.legacyNpcId,
            variant: newVariant,
          });
          const label = newVariant === "osrs" ? "OSRS" : "legacy 377";
          toast.success(`${row.displayName} switched to ${label}`, {
            description: "Per-NPC override applied.",
          });
        }
      }
    } catch (e) {
      toast.error("Failed to update variant", { description: (e as Error).message });
    }
  };

  // ---------- Reset all ----------
  const handleResetAll = async () => {
    try {
      await pref.update({ action: "clearAll" });
      toast.success("All preferences reset", {
        description: "Era preset reverted to 05era, overrides cleared.",
      });
    } catch (e) {
      toast.error("Failed to reset", { description: (e as Error).message });
    }
  };

  // ---------- Export preferences ----------
  const handleExport = async () => {
    if (!pref.data) return;
    const exportData = {
      playerId: pref.data.playerId,
      eraPreset: pref.data.eraPreset,
      npcOverrides: pref.data.npcOverrides,
      regionOverrides: pref.data.regionOverrides,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `player-${pref.data.playerId}-preferences.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Preferences exported", {
      description: `Downloaded player-${pref.data.playerId}-preferences.json`,
    });
  };

  // ---------- Share preferences (copy URL with encoded prefs) ----------
  const handleShare = async () => {
    if (!pref.data) return;
    try {
      // Build a PlayerPreference-shaped object for the encoder
      const url = await copyShareableUrl({
        playerId: pref.data.playerId,
        eraPreset: pref.data.eraPreset,
        npcOverrides: pref.data.npcOverrides,
        regionOverrides: pref.data.regionOverrides,
        favorites: pref.data.favorites ?? [],
        updatedAt: pref.data.updatedAt,
      });
      toast.success("Shareable URL copied to clipboard", {
        description: "Paste it anywhere — opening it will apply these preferences.",
      });
    } catch (e) {
      toast.error("Failed to copy URL", { description: (e as Error).message });
    }
  };

  // ---------- Apply preferences from URL hash on mount ----------
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#prefs=")) return;
    const decoded = decodePreferencesFromHash(hash);
    if (!decoded) return;
    // Apply the decoded preferences
    pref.update({
      action: "replace",
      eraPreset: decoded.eraPreset,
      npcOverrides: decoded.npcOverrides,
      regionOverrides: decoded.regionOverrides,
    }).then(() => {
      toast.success("Preferences applied from shared URL", {
        description: `Era: ${decoded.eraPreset}, ${Object.keys(decoded.npcOverrides).length} NPC overrides, ${Object.keys(decoded.regionOverrides).length} region overrides`,
      });
      // Clear the hash so it doesn't re-apply on refresh
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }).catch(() => {
      // silent
    });
  }, [pref]);

  // ---------- Import preferences ----------
  const handleImportClick = () => {
    fileImportRef.current?.click();
  };
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        eraPreset?: EraPresetId;
        npcOverrides?: Record<string, NpcVariant>;
        regionOverrides?: Record<string, NpcVariant>;
      };
      await pref.update({
        action: "replace",
        eraPreset: parsed.eraPreset,
        npcOverrides: parsed.npcOverrides,
        regionOverrides: parsed.regionOverrides,
      });
      toast.success("Preferences imported", {
        description: `Applied ${Object.keys(parsed.npcOverrides ?? {}).length} NPC overrides + ${Object.keys(parsed.regionOverrides ?? {}).length} region overrides.`,
      });
    } catch (err) {
      toast.error("Failed to import", {
        description: (err as Error).message,
      });
    } finally {
      // Reset the input so the same file can be re-imported
      if (fileImportRef.current) fileImportRef.current.value = "";
    }
  };

  // ---------- Region override handlers ----------
  const handleSetRegion = async (regionId: number, variant: NpcVariant) => {
    try {
      await pref.update({ action: "setRegionOverride", regionId, variant });
    } catch (e) {
      toast.error("Failed to set region override", { description: (e as Error).message });
    }
  };
  const handleClearRegion = async (regionId: number) => {
    try {
      await pref.update({ action: "clearRegionOverride", regionId });
      toast.success("Region override removed");
    } catch (e) {
      toast.error("Failed to clear region override", { description: (e as Error).message });
    }
  };

  // ---------- Drawer toggle handler ----------
  const handleDrawerToggle = async (npcId: number, variant: NpcVariant) => {
    try {
      await pref.update({ action: "setNpcOverride", npcId, variant });
      const npc = drawerNpc;
      if (npc) {
        const label = variant === "osrs" ? "OSRS" : "legacy 377";
        toast.success(`${npc.displayName} switched to ${label}`, {
          description: "Per-NPC override applied.",
        });
      }
    } catch (e) {
      toast.error("Failed to update variant", { description: (e as Error).message });
    }
  };
  const handleDrawerClear = async (npcId: number) => {
    try {
      await pref.update({ action: "clearNpcOverride", npcId });
      toast.success("Override cleared");
    } catch (e) {
      toast.error("Failed to clear override", { description: (e as Error).message });
    }
  };
  const handleViewDepMap = (debugname: string) => {
    // Stash the requested dep map name so the Dependency graph tab can pick it up
    try {
      sessionStorage.setItem("pendingDepMap", debugname);
    } catch {
      // sessionStorage might be unavailable in some contexts
    }
    // Switch to the Dependency graph tab via the global setter
    const w = window as unknown as { __setTab?: (t: "overview" | "configuration" | "deps") => void };
    w.__setTab?.("deps");
  };

  // ---------- Build full row list ----------
  const allRows = React.useMemo<DisplayRow[]>(() => {
    if (!variantsData) return [];
    const rows: DisplayRow[] = [];

    // Group lookup: osrsNpcId -> groupSize
    const groupSizeByOsrsId = new Map<number, number>();
    for (const group of variantsData.linkageGroups) {
      for (const id of group) {
        groupSizeByOsrsId.set(id, group.length);
      }
    }

    for (const v of variantsData.variants) {
      const groupSize = groupSizeByOsrsId.get(v.osrsNpcId);
      rows.push({
        kind: "variant",
        legacyNpcId: v.legacyNpcId,
        osrsNpcId: v.osrsNpcId,
        displayName: v.displayName,
        debugname: v.osrsDebugname,
        region: v.region || "Unknown",
        category: v.category,
        hasOsrsVariant: v.hasOsrsVariant,
        groupKey: groupSize && groupSize > 1 ? String(v.osrsNpcId) : undefined,
        groupSize,
      });
    }
    for (const l of variantsData.legacyOnlyNpcs) {
      rows.push({
        kind: "legacy-only",
        legacyNpcId: l.legacyNpcId,
        osrsNpcId: null,
        displayName: l.displayName,
        debugname: l.legacyDebugname,
        region: l.region,
        hasOsrsVariant: false,
      });
    }
    return rows;
  }, [variantsData]);

  // ---------- Apply filters ----------
  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q) {
        const hay = `${r.displayName} ${r.debugname}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (region !== "all" && r.region !== region) return false;
      if (category !== "all" && r.category !== category) return false;
      if (availability === "has-osrs" && !r.hasOsrsVariant) return false;
      if (availability === "legacy-only" && r.hasOsrsVariant) return false;
      return true;
    });
  }, [allRows, search, region, category, availability]);

  // ---------- Prune selection when filter changes ----------
  // If the user changes the filter so that selected NPCs are no longer
  // visible, clear them from the selection. This prevents "hidden
  // selections" where the bulk bar shows N selected but none are visible.
  React.useEffect(() => {
    if (selectedIds.size === 0) return;
    const visibleIds = new Set(filteredRows.map((r) => r.legacyNpcId));
    setSelectedIds((prev) => {
      const next = new Set<number>();
      let changed = false;
      for (const id of prev) {
        if (visibleIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filteredRows, selectedIds]);

  // ---------- Group filtered rows by region (favorites first within each) ----------
  const favoritesSet = React.useMemo(
    () => new Set(pref.data?.favorites ?? []),
    [pref.data?.favorites]
  );

  const groupedByRegion = React.useMemo(() => {
    const map = new Map<string, DisplayRow[]>();
    for (const r of filteredRows) {
      const key = r.region || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // Sort each region's rows: favorites first, then alphabetical
    for (const [, rows] of map) {
      rows.sort((a, b) => {
        const aFav = favoritesSet.has(a.legacyNpcId) ? 0 : 1;
        const bFav = favoritesSet.has(b.legacyNpcId) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        return a.displayName.localeCompare(b.displayName);
      });
    }
    // Sort regions: "Favorites" pseudo-region isn't needed since favorites
    // are sorted to the top within each region. Just alphabetical.
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows, favoritesSet]);

  const allRegions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(r.region || "Unknown");
    return Array.from(set).sort();
  }, [allRows]);

  const resetFilters = () => {
    setSearch("");
    setRegion("all");
    setCategory("all");
    setAvailability("all");
  };

  // ---------- Resolved variant lookup ----------
  const resolveRow = (row: DisplayRow): { resolved: NpcVariant; source: "override" | "era-preset" | "default" } => {
    if (!pref.data) return { resolved: "legacy377", source: "default" };
    if (row.kind === "variant") {
      const r = pref.data.resolutions.find((x) => x.legacyNpcId === row.legacyNpcId);
      if (r) return { resolved: r.resolved, source: r.source };
    }
    // Legacy-only NPCs always resolve to legacy377
    return { resolved: "legacy377", source: "default" };
  };

  // ---------- Loading state ----------
  if (variantsLoading && !variantsData) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="h-56 border-neutral-200/80">
              <CardContent className="space-y-3 py-4">
                <ShimmerSkeleton className="h-12 w-12 rounded-lg" />
                <ShimmerSkeleton className="h-4 w-1/2" />
                <ShimmerSkeleton className="h-3 w-2/3" />
                <ShimmerSkeleton className="h-3 w-full" />
                <ShimmerSkeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!variantsData) {
    return (
      <EmptyState
        icon={<SlidersHorizontal className="size-6" />}
        title="Variants API unavailable"
        description="The /api/variants endpoint didn't return any data. Check the API route and try again."
      />
    );
  }

  const currentPreset = pref.data?.eraPreset ?? "05era";

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* ---------- Mode toggle ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Configuration
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            Pick a global era preset, or dive into per-NPC overrides. Changes are saved
            per-player and reflected live across the dashboard.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setMode("basic")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "basic"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <Layers className="size-3.5" />
            Basic
          </button>
          <button
            type="button"
            onClick={() => setMode("advanced")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "advanced"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <SlidersHorizontal className="size-3.5" />
            Advanced
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "basic" ? (
          <motion.div
            key="basic"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            {/* Era preset cards */}
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {variantsData.eraPresets.map((p) => (
                <EraPresetCard
                  key={p.id}
                  preset={p}
                  isActive={currentPreset === p.id}
                  onSelect={handleSelectPreset}
                />
              ))}
            </motion.div>

            {/* Live impact preview */}
            <LiveImpactPreview
              eraPreset={currentPreset}
              variants={variantsData.variants}
            />
          </motion.div>
        ) : (
          <motion.div
            key="advanced"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {/* Sticky summary */}
            {pref.data && (
              <StickySummary
                eraPreset={pref.data.eraPreset}
                totalOverrides={pref.data.summary.totalOverrides}
                osrs={pref.data.summary.osrsResolved}
                legacy={pref.data.summary.legacyResolved}
              />
            )}

            {/* Filter bar */}
            <FilterBar
              search={search}
              onSearch={setSearch}
              region={region}
              onRegion={setRegion}
              category={category}
              onCategory={setCategory}
              availability={availability}
              onAvailability={setAvailability}
              regions={allRegions}
              onReset={resetFilters}
            />

            {/* Bulk action bar (appears when NPCs are selected) */}
            <BulkActionBar
              selectedCount={selectedIds.size}
              onSelectAll={() => selectAllVisible(filteredRows.map((r) => r.legacyNpcId))}
              onClearSelection={clearSelection}
              onBulkSet={handleBulkSet}
              onBulkClear={handleBulkClear}
            />

            {/* NPC list grouped by region */}
            <Card className="overflow-hidden border-neutral-200/80 shadow-sm">
              <CardHeader className="border-b border-neutral-200 bg-neutral-50/60 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold text-neutral-900">
                    NPC variants
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      <Filter className="mr-1 size-3" />
                      {filteredRows.length} shown
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      of {allRows.length} total
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {groupedByRegion.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                      <Search className="size-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-700">No NPCs match your filters</p>
                      <p className="mt-1 text-xs text-neutral-500">Try clearing the search or widening the filters.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={resetFilters} className="gap-1.5">
                      <RotateCcw className="size-3.5" />
                      Reset filters
                    </Button>
                  </div>
                ) : (
                  <ScrollArea className="max-h-[640px]">
                    <div className="p-3">
                      {groupedByRegion.map(([regionName, rows]) => (
                        <div key={regionName} className="mb-5 last:mb-0">
                          <div className="mb-2 flex items-center gap-2">
                            <Globe className="size-3.5 text-neutral-400" />
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                              {regionName}
                            </span>
                            <Badge
                              variant="outline"
                              className="border-neutral-200 bg-neutral-50 font-mono text-[9px] text-neutral-500"
                            >
                              {rows.length}
                            </Badge>
                            <div className="h-px flex-1 bg-gradient-to-r from-neutral-200 to-transparent" />
                          </div>
                          <motion.div
                            variants={staggerContainer}
                            initial="hidden"
                            animate="show"
                            className="space-y-1.5"
                          >
                            {rows.map((row) => {
                              const { resolved, source } = resolveRow(row);
                              const drawerNpc = row.kind === "variant"
                                ? variantsData?.variants.find((v) => v.legacyNpcId === row.legacyNpcId) ?? null
                                : null;
                              return (
                                <NpcRow
                                  key={`${row.kind}-${row.legacyNpcId}-${row.osrsNpcId ?? "x"}`}
                                  row={row}
                                  resolved={resolved}
                                  source={source}
                                  onToggle={() => handleToggleNpc(row)}
                                  onOpenDetails={() => drawerNpc && setDrawerNpc(drawerNpc)}
                                  isSelected={selectedIds.has(row.legacyNpcId)}
                                  isFavorite={favoritesSet.has(row.legacyNpcId)}
                                  onToggleSelect={() => toggleSelect(row.legacyNpcId)}
                                  onToggleFavorite={() => handleToggleFavorite(row.legacyNpcId)}
                                />
                              );
                            })}
                          </motion.div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Region overrides */}
            <RegionOverrides
              regionOverrides={pref.data?.regionOverrides ?? {}}
              onSetRegion={handleSetRegion}
              onClearRegion={handleClearRegion}
            />

            {/* Action buttons: export / import / reset */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                ref={fileImportRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={handleShare}
                    className="gap-1.5"
                    disabled={!pref.data}
                  >
                    <Share2 className="size-4" />
                    <span className="hidden sm:inline">Share</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Copy a shareable URL with these preferences encoded
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={handleExport}
                    className="gap-1.5"
                    disabled={!pref.data}
                  >
                    <Download className="size-4" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Download this player&apos;s preferences as a JSON file
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={handleImportClick}
                    className="gap-1.5"
                  >
                    <Upload className="size-4" />
                    <span className="hidden sm:inline">Import</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Load preferences from a previously-exported JSON file
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                onClick={handleResetAll}
                className="gap-1.5"
                disabled={!pref.data || (pref.data.eraPreset === "05era" && pref.data.summary.totalOverrides === 0 && Object.keys(pref.data.regionOverrides).length === 0)}
              >
                <Undo2 className="size-4" />
                Reset to defaults
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NPC detail drawer */}
      <NpcDetailDrawer
        npc={drawerNpc}
        onClose={() => setDrawerNpc(null)}
        resolved={
          drawerNpc && pref.data
            ? (pref.data.resolutions.find((r) => r.legacyNpcId === drawerNpc.legacyNpcId)?.resolved ?? "legacy377")
            : "legacy377"
        }
        source={
          drawerNpc && pref.data
            ? (pref.data.resolutions.find((r) => r.legacyNpcId === drawerNpc.legacyNpcId)?.source ?? "default")
            : "default"
        }
        eraPreset={pref.data?.eraPreset ?? "05era"}
        onToggleVariant={handleDrawerToggle}
        onClearOverride={handleDrawerClear}
        onViewDepMap={handleViewDepMap}
      />
    </motion.div>
  );
}

// (end of file)
