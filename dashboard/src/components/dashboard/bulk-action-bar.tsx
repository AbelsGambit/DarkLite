"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  CheckSquare,
  X,
  Sparkles,
  Layers,
  Eraser,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { NpcVariant } from "./types";

export type BulkActionBarProps = {
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkSet: (variant: NpcVariant) => void;
  onBulkClear: () => void;
};

export function BulkActionBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onBulkSet,
  onBulkClear,
}: BulkActionBarProps) {
  const isVisible = selectedCount > 0;

  const handleBulkSet = (variant: NpcVariant) => {
    onBulkSet(variant);
    const label = variant === "osrs" ? "OSRS" : "legacy 377";
    toast.success(`Bulk applied ${label}`, {
      description: `${selectedCount} NPC${selectedCount === 1 ? "" : "s"} set to ${label}.`,
    });
  };

  const handleBulkClear = () => {
    onBulkClear();
    toast.success(`Bulk cleared ${selectedCount} override${selectedCount === 1 ? "" : "s"}`, {
      description: "Selected NPCs now follow the era preset.",
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="sticky top-[105px] z-30 -mx-1 mb-3 rounded-lg border border-purple-200 bg-purple-50/95 px-3 py-2.5 shadow-md backdrop-blur dark:border-purple-800 dark:bg-purple-950/80"
        >
          <div className="flex flex-wrap items-center gap-2">
            {/* Selection count */}
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-purple-500 text-white">
                <CheckSquare className="size-3.5" />
              </div>
              <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                {selectedCount} selected
              </span>
            </div>

            <Separator orientation="vertical" className="hidden h-5 bg-purple-200 sm:block dark:bg-purple-800" />

            {/* Bulk actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkSet("osrs")}
                className="gap-1.5 border-purple-200 bg-white text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/50 dark:text-purple-200 dark:hover:bg-purple-900"
              >
                <Sparkles className="size-3.5" />
                Set all OSRS
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkSet("legacy377")}
                className="gap-1.5 border-purple-200 bg-white text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/50 dark:text-purple-200 dark:hover:bg-purple-900"
              >
                <Layers className="size-3.5" />
                Set all legacy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkClear}
                className="gap-1.5 border-purple-200 bg-white text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/50 dark:text-purple-200 dark:hover:bg-purple-900"
              >
                <Eraser className="size-3.5" />
                Clear overrides
              </Button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onSelectAll}
                className="text-xs text-purple-700 hover:bg-purple-100 dark:text-purple-200 dark:hover:bg-purple-900"
              >
                Select all visible
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearSelection}
                className="gap-1 text-xs text-purple-700 hover:bg-purple-100 dark:text-purple-200 dark:hover:bg-purple-900"
                aria-label="Clear selection"
              >
                <X className="size-3.5" />
                Clear
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
