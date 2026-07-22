"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MapPin, Plus, X, Globe, Info } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
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
  ACCENT_BG,
  ACCENT_BORDER,
  ACCENT_TEXT,
  EmptyState,
  SectionHeader,
  staggerContainer,
  staggerItem,
} from "./primitives";
import type { NpcVariant } from "./types";

// Region ID → display name. In the real LostCity engine, region IDs are
// packed map coordinates. For the demo we use a curated list of iconic
// 2006-era regions the user might want to toggle.
const KNOWN_REGIONS: { id: number; name: string; desc: string }[] = [
  { id: 10000, name: "Lumbridge", desc: "Starting town — human NPCs, goblins" },
  { id: 10001, name: "Varrock", desc: "Capital city — guards, shopkeepers" },
  { id: 10002, name: "Falador", desc: "White knight city" },
  { id: 10003, name: "Wilderness", desc: "High-risk PvP zone — dragons, demons" },
  { id: 10004, name: "Kalphite Lair", desc: "KQ boss room" },
  { id: 10005, name: "Ancient Guthixian Temple", desc: "TD spawn — While Guthix Sleeps" },
  { id: 10006, name: "Taverley Dungeon", desc: "Black dragons, hill giants" },
  { id: 10007, name: "Karamja Volcano", desc: "Lesser + greater demons" },
];

export type RegionOverridesProps = {
  regionOverrides: Record<string, NpcVariant>;
  onSetRegion: (regionId: number, variant: NpcVariant) => void;
  onClearRegion: (regionId: number) => void;
};

export function RegionOverrides({
  regionOverrides,
  onSetRegion,
  onClearRegion,
}: RegionOverridesProps) {
  const [newRegion, setNewRegion] = React.useState<string>("");

  const activeRegionIds = Object.keys(regionOverrides).map(Number);
  const activeRegions = activeRegionIds
    .map((id) => KNOWN_REGIONS.find((r) => r.id === id))
    .filter((r): r is { id: number; name: string; desc: string } => !!r);

  const availableToAdd = KNOWN_REGIONS.filter((r) => !regionOverrides[String(r.id)]);

  const handleAdd = () => {
    if (!newRegion) return;
    const id = parseInt(newRegion);
    const region = KNOWN_REGIONS.find((r) => r.id === id);
    if (!region) return;
    onSetRegion(id, "osrs");
    toast.success(`Added region override`, {
      description: `${region.name} will now use OSRS models for all NPCs spawned there.`,
    });
    setNewRegion("");
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      <SectionHeader
        icon={<MapPin className="size-4" />}
        title="Per-region overrides"
        accent="orange"
        hint={
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex cursor-help items-center gap-1 text-neutral-400">
                <Info className="size-3.5" />
                advanced
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[280px] text-xs">
              Per-region overrides apply to ALL NPCs spawned in that region,
              taking precedence over the era preset but yielding to per-NPC
              overrides. Useful for &ldquo;use OSRS for Wilderness bosses,
              legacy for Lumbridge townsfolk.&rdquo;
            </TooltipContent>
          </Tooltip>
        }
      />

      <Card className="border-neutral-200/80 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold text-neutral-900">
                Region overrides
              </CardTitle>
              <CardDescription className="text-xs">
                Force a variant for every NPC spawned in a specific region.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              {activeRegions.length} active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new region override */}
          {availableToAdd.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-2">
              <Select value={newRegion} onValueChange={setNewRegion}>
                <SelectTrigger className="h-8 min-w-[180px] flex-1 border-neutral-200 bg-white text-xs">
                  <SelectValue placeholder="Pick a region…" />
                </SelectTrigger>
                <SelectContent>
                  {availableToAdd.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-2 text-[10px] text-neutral-400">{r.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newRegion}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                Add override
              </Button>
            </div>
          )}

          {/* Active region overrides */}
          {activeRegions.length === 0 ? (
            <EmptyState
              icon={<Globe className="size-5" />}
              title="No region overrides set"
              description={
                <>
                  Add a region above to force all NPCs spawned there to use a
                  specific variant. Useful for keeping town NPCs on legacy while
                  using OSRS for Wilderness bosses.
                </>
              }
            />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-1.5"
            >
              {activeRegions.map((region) => {
                const variant = regionOverrides[String(region.id)];
                const isOsrs = variant === "osrs";
                return (
                  <motion.div
                    key={region.id}
                    variants={staggerItem}
                    className="flex items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-700 ring-1 ring-orange-200">
                      <MapPin className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-neutral-900">
                          {region.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 font-mono text-[9px] text-neutral-500"
                        >
                          region {region.id}
                        </Badge>
                      </div>
                      <div className="truncate text-[10px] text-neutral-500">
                        {region.desc}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-[9px] font-medium uppercase tracking-wide text-neutral-500">
                        377
                      </span>
                      <Switch
                        checked={isOsrs}
                        onCheckedChange={(checked) => {
                          const v: NpcVariant = checked ? "osrs" : "legacy377";
                          onSetRegion(region.id, v);
                        }}
                        className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-amber-400"
                        aria-label={`Toggle ${region.name} variant`}
                      />
                      <span className="font-mono text-[9px] font-medium uppercase tracking-wide text-neutral-500">
                        osrs
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-1 size-6 text-neutral-400 hover:text-red-600"
                        onClick={() => onClearRegion(region.id)}
                        aria-label={`Remove ${region.name} override`}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* Legend */}
          <div className="rounded-md border-l-2 border-orange-300 bg-orange-50/60 px-3 py-2 text-[11px] text-orange-800">
            <strong>Resolution order:</strong> per-NPC override → per-region override
            → era preset → server default. Region overrides are a middle ground —
            they win over the era preset but lose to per-NPC overrides.
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
