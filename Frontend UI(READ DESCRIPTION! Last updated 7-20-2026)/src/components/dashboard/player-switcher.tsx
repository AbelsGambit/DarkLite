"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronsUpDown, Check, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePlayerList } from "./hooks";
import { usePlayerId } from "./player-context";
import type { EraPresetId } from "./types";

const PRESET_LABEL: Record<EraPresetId, string> = {
  "05era": "2005 era",
  "07era": "2007 era",
  allOSRS: "All OSRS",
  mixed: "Mixed",
};

const PRESET_ACCENT: Record<EraPresetId, string> = {
  "05era": "border-amber-200 bg-amber-50 text-amber-700",
  "07era": "border-rose-200 bg-rose-50 text-rose-700",
  allOSRS: "border-emerald-200 bg-emerald-50 text-emerald-700",
  mixed: "border-teal-200 bg-teal-50 text-teal-700",
};

export function PlayerSwitcher() {
  const { playerId, setPlayerId } = usePlayerId();
  const { data: playerList, loading } = usePlayerList();
  const [open, setOpen] = React.useState(false);

  const currentPlayer = playerList?.players.find((p) => p.playerId === playerId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 border-neutral-200 bg-white px-3 font-mono text-xs shadow-sm transition-colors hover:bg-neutral-50"
          aria-label={`Player switcher — currently viewing player ${playerId}`}
        >
          <div className="flex size-5 items-center justify-center rounded-full bg-neutral-900 text-white">
            <User className="size-3" />
          </div>
          <span className="font-semibold text-neutral-900">P{playerId}</span>
          {currentPlayer && (
            <Badge
              variant="outline"
              className={`ml-1 hidden border px-1 py-0 text-[9px] sm:inline-flex ${PRESET_ACCENT[currentPlayer.eraPreset]}`}
            >
              {PRESET_LABEL[currentPlayer.eraPreset]}
            </Badge>
          )}
          <ChevronsUpDown className="size-3.5 text-neutral-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="mb-2 flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          <Users className="size-3" />
          Switch player view
        </div>
        <div className="space-y-0.5">
          {loading && !playerList ? (
            <div className="px-2 py-3 text-center text-xs text-neutral-400">Loading…</div>
          ) : (
            playerList?.players.map((p) => {
              const isActive = p.playerId === playerId;
              return (
                <button
                  key={p.playerId}
                  type="button"
                  onClick={() => {
                    setPlayerId(p.playerId);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-neutral-100" : "hover:bg-neutral-50"
                  }`}
                >
                  <div
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                      isActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {p.playerId}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-neutral-900">
                      Player {p.playerId}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                      <Badge
                        variant="outline"
                        className={`px-1 py-0 text-[9px] ${PRESET_ACCENT[p.eraPreset]}`}
                      >
                        {PRESET_LABEL[p.eraPreset]}
                      </Badge>
                      <span className="font-mono">{p.totalOverrides} overrides</span>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              );
            })
          )}
        </div>
        <div className="mt-2 border-t border-neutral-100 px-2 py-1.5 text-[10px] text-neutral-400">
          The dashboard polls each player&apos;s preferences independently. Switching
          here updates the Overview live-resolution card and the Configuration tab.
        </div>
      </PopoverContent>
    </Popover>
  );
}
