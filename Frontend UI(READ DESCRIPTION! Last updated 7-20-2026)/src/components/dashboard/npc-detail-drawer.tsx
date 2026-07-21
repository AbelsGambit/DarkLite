"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Box,
  GitBranch,
  Database,
  Layers,
  MapPin,
  Calendar,
  Tag,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ACCENT_BG,
  ACCENT_BORDER,
  ACCENT_HEX,
  ACCENT_RING,
  ACCENT_TEXT,
  CountUp,
} from "./primitives";
import type { UnifiedVariant, NpcVariant, EraPresetId } from "./types";

export type NpcDetailDrawerProps = {
  npc: UnifiedVariant | null;
  onClose: () => void;
  resolved: NpcVariant;
  source: "override" | "era-preset" | "default";
  eraPreset: EraPresetId;
  onToggleVariant: (npcId: number, variant: NpcVariant) => void;
  onClearOverride: (npcId: number) => void;
  onViewDepMap: (debugname: string) => void;
};

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ReactNode; accent: "rose" | "purple" | "teal" }
> = {
  boss: { label: "Boss", icon: <AlertTriangle className="size-3" />, accent: "rose" },
  new: { label: "New", icon: <Tag className="size-3" />, accent: "purple" },
  upgrade: { label: "Upgrade", icon: <Layers className="size-3" />, accent: "teal" },
};

export function NpcDetailDrawer({
  npc,
  onClose,
  resolved,
  source,
  eraPreset,
  onToggleVariant,
  onClearOverride,
  onViewDepMap,
}: NpcDetailDrawerProps) {
  const [copied, setCopied] = React.useState(false);
  const hasBothVariants = npc?.hasOsrsVariant && npc?.hasLegacyVariant;

  // Esc to close
  React.useEffect(() => {
    if (!npc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [npc, onClose]);

  const handleCopyDebugname = async () => {
    if (!npc) return;
    try {
      await navigator.clipboard.writeText(npc.osrsDebugname);
      setCopied(true);
      toast.success("Debugname copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <AnimatePresence>
      {npc && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-neutral-900/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 38 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`${npc.displayName} details`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-neutral-900">
                    {npc.displayName}
                  </h2>
                  {npc.category && CATEGORY_META[npc.category] && (
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] ${ACCENT_BORDER[CATEGORY_META[npc.category].accent]} ${ACCENT_BG[CATEGORY_META[npc.category].accent]} ${ACCENT_TEXT[CATEGORY_META[npc.category].accent]}`}
                    >
                      {CATEGORY_META[npc.category].icon}
                      <span className="ml-1">{CATEGORY_META[npc.category].label}</span>
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleCopyDebugname}
                  className="mt-1 flex items-center gap-1.5 font-mono text-xs text-neutral-500 transition-colors hover:text-neutral-800"
                >
                  <span className="truncate">{npc.osrsDebugname}</span>
                  {copied ? (
                    <Check className="size-3 shrink-0 text-emerald-500" />
                  ) : (
                    <Copy className="size-3 shrink-0" />
                  )}
                </button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-8 shrink-0 text-neutral-400 hover:text-neutral-700"
                aria-label="Close drawer"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Body */}
            <ScrollArea className="flex-1">
              <div className="space-y-5 px-5 py-4">
                {/* Variant toggle (the main control) */}
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Box className="size-4 text-neutral-500" />
                      <span className="text-sm font-semibold text-neutral-900">
                        Active variant
                      </span>
                    </div>
                    {source === "override" && (
                      <Badge className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                        override
                      </Badge>
                    )}
                  </div>

                  {hasBothVariants ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
                            Legacy 377
                          </span>
                          <div
                            className={`flex size-9 items-center justify-center rounded-full border-2 text-xs font-mono font-semibold transition-all ${
                              resolved === "legacy377"
                                ? "border-amber-500 bg-amber-100 text-amber-800"
                                : "border-neutral-200 bg-white text-neutral-400"
                            }`}
                          >
                            377
                          </div>
                        </div>

                        <div className="flex flex-1 flex-col items-center gap-1">
                          <Switch
                            checked={resolved === "osrs"}
                            onCheckedChange={(checked) => {
                              const v: NpcVariant = checked ? "osrs" : "legacy377";
                              onToggleVariant(npc.legacyNpcId, v);
                            }}
                            className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-amber-400"
                            aria-label="Toggle variant"
                          />
                          <span className="text-[9px] text-neutral-400">
                            {source === "override" ? "overriding era preset" : `via ${eraPreset}`}
                          </span>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                            OSRS
                          </span>
                          <div
                            className={`flex size-9 items-center justify-center rounded-full border-2 text-xs font-mono font-semibold transition-all ${
                              resolved === "osrs"
                                ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                                : "border-neutral-200 bg-white text-neutral-400"
                            }`}
                          >
                            OS
                          </div>
                        </div>
                      </div>

                      {source === "override" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-3 w-full text-xs text-neutral-500 hover:text-neutral-800"
                          onClick={() => onClearOverride(npc.legacyNpcId)}
                        >
                          Clear override (revert to era preset)
                        </Button>
                      )}
                    </>
                  ) : npc.hasOsrsVariant && !npc.hasLegacyVariant ? (
                    <div className="flex items-center gap-3 rounded-md border border-purple-200 bg-purple-50/60 px-3 py-2 text-xs text-purple-700">
                      <Tag className="size-4 shrink-0" />
                      <span>
                        This NPC has no legacy 377 equivalent — the OSRS model is the only
                        option. It will always render as OSRS regardless of the era preset.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>
                        No OSRS variant has been imported for this NPC yet. Run the import
                        pipeline to enable toggling.
                      </span>
                    </div>
                  )}
                </div>

                {/* Metadata grid */}
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Metadata
                  </h3>
                  <dl className="grid grid-cols-2 gap-2">
                    <MetaTile
                      icon={<Database className="size-3.5" />}
                      label="Legacy ID"
                      value={
                        npc.legacyNpcId === -1 ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <span className="font-mono">{npc.legacyNpcId}</span>
                        )
                      }
                    />
                    <MetaTile
                      icon={<Database className="size-3.5" />}
                      label="OSRS ID"
                      value={<span className="font-mono">{npc.osrsNpcId}</span>}
                    />
                    <MetaTile
                      icon={<MapPin className="size-3.5" />}
                      label="Region"
                      value={npc.region || "Unknown"}
                    />
                    <MetaTile
                      icon={<Calendar className="size-3.5" />}
                      label="Year added"
                      value={<span className="font-mono">{npc.yearAdded}</span>}
                    />
                    <MetaTile
                      icon={<Tag className="size-3.5" />}
                      label="OSRS source"
                      value={<span className="font-mono">{npc.osrsSourceNpcId}</span>}
                    />
                    <MetaTile
                      icon={<Calendar className="size-3.5" />}
                      label="Imported at"
                      value={
                        <span className="font-mono text-[11px]">
                          {new Date(npc.importedAt).toLocaleDateString()}
                        </span>
                      }
                    />
                  </dl>
                </div>

                {/* Dependency map link */}
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Dependency map
                  </h3>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 text-xs"
                    onClick={() => {
                      onViewDepMap(npc.osrsDebugname);
                      onClose();
                    }}
                  >
                    <GitBranch className="size-3.5" />
                    <span className="truncate font-mono">{npc.depMapPath}</span>
                    <ExternalLink className="ml-auto size-3.5" />
                  </Button>
                  <p className="mt-1.5 text-[10px] text-neutral-400">
                    Opens the Dependency graph tab with this NPC&apos;s dep map loaded.
                  </p>
                </div>

                {/* Source tag */}
                <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[10px] text-neutral-500">
                  <span className="font-mono">
                    {npc.isDemo ? "demo data" : "real import"}
                  </span>
                  {" — "}
                  {npc.isDemo
                    ? "Synthesized for dashboard preview. Real variants will appear here once the OSRS cache is imported."
                    : "Imported from a real OSRS cache via the pipeline."}
                </div>
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="border-t border-neutral-200 px-5 py-3">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>
                  Press <kbd className="rounded border border-neutral-300 bg-white px-1 font-mono">Esc</kbd> to close
                </span>
                <span className="font-mono">player view · source: {source}</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function MetaTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-xs text-neutral-900">{value}</div>
    </div>
  );
}
