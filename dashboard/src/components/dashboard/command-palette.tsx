"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  LayoutDashboard,
  SlidersHorizontal,
  GitBranch,
  Sun,
  Moon,
  RotateCcw,
  Download,
  User,
  Database,
  Keyboard,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "./theme-context";
import { usePlayerId } from "./player-context";
import type { PlayerListItem, UnifiedVariant } from "./types";

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: "navigation" | "actions" | "players" | "theme" | "npcs";
  keywords?: string[];
  shortcut?: string;
  action: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: PlayerListItem[];
  variants: UnifiedVariant[];
  onSwitchPlayer: (id: number) => void;
  onSwitchTab: (tab: "overview" | "configuration" | "deps") => void;
  onResetPreferences: () => void;
  onExportPreferences: () => void;
  onShowShortcuts: () => void;
  onShowTour: () => void;
  onOpenNpc: (debugname: string) => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  players,
  variants,
  onSwitchPlayer,
  onSwitchTab,
  onResetPreferences,
  onExportPreferences,
  onShowShortcuts,
  onShowTour,
  onOpenNpc,
}: CommandPaletteProps) {
  const { theme, toggleTheme } = useTheme();
  const { playerId } = usePlayerId();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Build command list
  const commands: Command[] = React.useMemo(() => {
    const nav: Command[] = [
      {
        id: "nav-overview",
        label: "Go to Overview",
        icon: <LayoutDashboard className="size-4" />,
        group: "navigation",
        shortcut: "1",
        action: () => onSwitchTab("overview"),
      },
      {
        id: "nav-config",
        label: "Go to Configuration",
        icon: <SlidersHorizontal className="size-4" />,
        group: "navigation",
        shortcut: "2",
        action: () => onSwitchTab("configuration"),
      },
      {
        id: "nav-deps",
        label: "Go to Dependency graph",
        icon: <GitBranch className="size-4" />,
        group: "navigation",
        shortcut: "3",
        action: () => onSwitchTab("deps"),
      },
    ];

    const actions: Command[] = [
      {
        id: "action-reset",
        label: "Reset preferences to defaults",
        hint: "Clears era preset + all overrides for current player",
        icon: <RotateCcw className="size-4" />,
        group: "actions",
        keywords: ["clear", "undo", "revert"],
        action: onResetPreferences,
      },
      {
        id: "action-export",
        label: "Export preferences as JSON",
        hint: "Download current player's preferences",
        icon: <Download className="size-4" />,
        group: "actions",
        keywords: ["download", "save", "backup"],
        action: onExportPreferences,
      },
      {
        id: "action-shortcuts",
        label: "Show keyboard shortcuts",
        icon: <Keyboard className="size-4" />,
        group: "actions",
        shortcut: "?",
        keywords: ["help", "keys"],
        action: onShowShortcuts,
      },
      {
        id: "action-tour",
        label: "Show onboarding tour",
        hint: "Walkthrough of the dashboard's features",
        icon: <Sparkles className="size-4" />,
        group: "actions",
        keywords: ["welcome", "intro", "guide", "tutorial", "onboarding"],
        action: onShowTour,
      },
    ];

    const themeCmds: Command[] = [
      {
        id: "theme-toggle",
        label: theme === "light" ? "Switch to dark mode" : "Switch to light mode",
        icon: theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />,
        group: "theme",
        keywords: ["appearance", "color", "night"],
        action: toggleTheme,
      },
    ];

    const playerCmds: Command[] = players.map((p) => ({
      id: `player-${p.playerId}`,
      label: `Switch to player ${p.playerId}`,
      hint: `${p.eraPreset} · ${p.totalOverrides} overrides`,
      icon: (
        <div className="flex size-4 items-center justify-center rounded-full bg-neutral-900 text-[8px] font-bold text-white">
          {p.playerId}
        </div>
      ),
      group: "players" as const,
      keywords: ["user", "account", `p${p.playerId}`],
      action: () => onSwitchPlayer(p.playerId),
    }));

    // NPC commands — jump to a specific NPC's dep map
    const npcCmds: Command[] = variants.map((v) => ({
      id: `npc-${v.osrsNpcId}`,
      label: v.displayName,
      hint: `View dep map · ${v.region || "unknown"}`,
      icon: <ExternalLink className="size-4" />,
      group: "npcs" as const,
      keywords: [v.osrsDebugname, v.legacyDebugname, v.category, v.region ?? ""],
      action: () => onOpenNpc(v.osrsDebugname),
    }));

    return [...nav, ...actions, ...playerCmds, ...themeCmds, ...npcCmds];
  }, [theme, toggleTheme, players, variants, onSwitchTab, onResetPreferences, onExportPreferences, onShowShortcuts, onShowTour, onSwitchPlayer, onOpenNpc]);

  // Filter commands by query
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ""} ${c.keywords?.join(" ") ?? ""} ${c.group}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  // Reset active index when query changes or palette opens
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      // Small delay so the input is mounted
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    } else {
      setQuery("");
    }
  }, [open]);

  // Keyboard navigation within the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) {
        cmd.action();
        onOpenChange(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  // Scroll active item into view
  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector(`[data-cmd-idx="${activeIndex}"]`);
    if (active && "scrollIntoView" in active) {
      (active as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  // Group filtered commands
  const grouped = React.useMemo(() => {
    const groups: { label: string; cmds: Command[] }[] = [];
    const groupLabels: Record<string, string> = {
      navigation: "Navigation",
      actions: "Actions",
      players: "Switch player",
      npcs: "Jump to NPC",
      theme: "Appearance",
    };
    const order = ["navigation", "players", "actions", "npcs", "theme"];
    for (const g of order) {
      const cmds = filtered.filter((c) => c.group === g);
      if (cmds.length > 0) groups.push({ label: groupLabels[g] || g, cmds });
    }
    return groups;
  }, [filtered]);

  // Flatten for indexing
  const flatIndex = React.useMemo(() => {
    let idx = 0;
    const map = new Map<string, number>();
    for (const g of grouped) {
      for (const c of g.cmds) {
        map.set(c.id, idx++);
      }
    }
    return map;
  }, [grouped]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-neutral-900/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="fixed left-1/2 top-[15%] z-[60] flex w-full max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
              <Search className="size-4 shrink-0 text-neutral-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command or search…"
                className="flex-1 bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
                aria-label="Search commands"
                aria-controls="command-palette-results"
              />
              <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                esc
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} id="command-palette-results" className="max-h-[60vh] overflow-y-auto p-2">
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <Search className="size-6 text-neutral-300 dark:text-neutral-600" />
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No commands match &ldquo;{query}&rdquo;
                  </p>
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.label} className="mb-2 last:mb-0">
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.cmds.map((cmd) => {
                        const idx = flatIndex.get(cmd.id)!;
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={cmd.id}
                            type="button"
                            data-cmd-idx={idx}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => {
                              cmd.action();
                              onOpenChange(false);
                            }}
                            className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                              isActive
                                ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                                : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/50"
                            }`}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                              {cmd.icon}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">
                                {cmd.label}
                              </div>
                              {cmd.hint && (
                                <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                                  {cmd.hint}
                                </div>
                              )}
                            </div>
                            {cmd.shortcut && (
                              <kbd className="shrink-0 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                                {cmd.shortcut}
                              </kbd>
                            )}
                            {isActive && (
                              <CornerDownLeft className="size-3 shrink-0 text-neutral-400 dark:text-neutral-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2 text-[10px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <ArrowUp className="size-3" />
                  <ArrowDown className="size-3" />
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="size-3" />
                  select
                </span>
              </div>
              <span className="font-mono">
                {filtered.length} result{filtered.length === 1 ? "" : "s"}
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
