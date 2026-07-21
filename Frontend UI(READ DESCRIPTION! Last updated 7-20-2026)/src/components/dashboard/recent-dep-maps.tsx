"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clock, X, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type RecentDepMapsProps = {
  recent: string[];
  currentName: string | null;
  onSelect: (name: string) => void;
};

export function RecentDepMaps({ recent, currentName, onSelect }: RecentDepMapsProps) {
  if (recent.length === 0) return null;

  // Don't show the currently-loaded one in the recent list (it's already loaded)
  const others = recent.filter((n) => n !== currentName);
  if (others.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center gap-1.5"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <History className="size-3" />
            Recent
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Dep maps you&apos;ve recently viewed (shared across players)
        </TooltipContent>
      </Tooltip>
      {others.slice(0, 6).map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect(name)}
          className="group flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-0.5 font-mono text-[10px] text-neutral-600 transition-colors hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-purple-700 dark:hover:bg-purple-900/30 dark:hover:text-purple-300"
        >
          <Clock className="size-2.5 text-neutral-400 group-hover:text-purple-500 dark:text-neutral-500" />
          <span className="max-w-[160px] truncate">{name}</span>
        </button>
      ))}
    </motion.div>
  );
}
