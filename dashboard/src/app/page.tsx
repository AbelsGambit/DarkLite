"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Cpu,
  GitBranch,
  Keyboard,
  LayoutDashboard,
  Package,
  Play,
  Search,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { ConfigurationTab } from "@/components/dashboard/configuration-tab";
import { DependencyGraphTab } from "@/components/dashboard/dependency-graph-tab";
import { DebugTab } from "@/components/dashboard/debug-tab";
import { PlayTab } from "@/components/dashboard/play-tab";
import { ModelsTab } from "@/components/dashboard/models-tab";
import { PlayerProvider, usePlayerId } from "@/components/dashboard/player-context";
import { PlayerSwitcher } from "@/components/dashboard/player-switcher";
import { ThemeProvider } from "@/components/dashboard/theme-context";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { OnboardingTour } from "@/components/dashboard/onboarding-tour";
import { usePipelineStatus, usePlayerList, useVariants } from "@/components/dashboard/hooks";
import { cn } from "@/lib/utils";

type TabId = "overview" | "configuration" | "deps" | "models" | "debug" | "play";

const TABS: {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  accent: "amber" | "emerald" | "rose" | "violet" | "blue" | "cyan";
  underline: string;
  shortcut: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: <LayoutDashboard className="size-4" />,
    accent: "amber",
    underline: "from-amber-400 to-orange-400",
    shortcut: "1",
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: <SlidersHorizontal className="size-4" />,
    accent: "emerald",
    underline: "from-emerald-400 to-teal-400",
    shortcut: "2",
  },
  {
    id: "deps",
    label: "Dependency graph",
    icon: <GitBranch className="size-4" />,
    accent: "rose",
    underline: "from-rose-400 to-orange-400",
    shortcut: "3",
  },
  {
    id: "models",
    label: "Models",
    icon: <Package className="size-4" />,
    accent: "cyan",
    underline: "from-cyan-400 to-blue-400",
    shortcut: "4",
  },
  {
    id: "debug",
    label: "Debug",
    icon: <Bug className="size-4" />,
    accent: "violet",
    underline: "from-violet-400 to-purple-400",
    shortcut: "5",
  },
  {
    id: "play",
    label: "Play",
    icon: <Play className="size-4" />,
    accent: "blue",
    underline: "from-blue-400 to-cyan-400",
    shortcut: "6",
  },
];

export default function Home() {
  const [tab, setTab] = React.useState<TabId>("overview");
  const { data, error, loading } = usePipelineStatus();
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showPalette, setShowPalette] = React.useState(false);

  // Expose global setters so child components (NPC detail drawer) can switch
  // tabs + open the command palette without prop-drilling.
  React.useEffect(() => {
    const w = window as unknown as {
      __setTab?: (t: TabId) => void;
      __openPalette?: () => void;
    };
    w.__setTab = (t: TabId) => setTab(t);
    w.__openPalette = () => setShowPalette(true);
    return () => {
      delete w.__setTab;
      delete w.__openPalette;
    };
  }, []);

  // Keyboard shortcuts: 1/2/3 switch tabs, ? toggles shortcut help,
  // Cmd/Ctrl+K opens the command palette.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opens the palette (works even from inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette(true);
        return;
      }
      // Skip the rest if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        target?.getAttribute("role") === "combobox" ||
        target?.getAttribute("role") === "option"
      ) {
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        setTab("overview");
      } else if (e.key === "2") {
        e.preventDefault();
        setTab("configuration");
      } else if (e.key === "3") {
        e.preventDefault();
        setTab("deps");
      } else if (e.key === "4") {
        e.preventDefault();
        setTab("models");
      } else if (e.key === "5") {
        e.preventDefault();
        setTab("debug");
      } else if (e.key === "6") {
        e.preventDefault();
        setTab("play");
      } else if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if (e.key === "Escape" && showShortcuts) {
        setShowShortcuts(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts]);

  return (
    <ThemeProvider>
    <PlayerProvider>
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-neutral-50/40 dark:bg-neutral-950">
        <Toaster richColors position="bottom-right" />

        {/* ---------- Header ---------- */}
        <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/85 backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/85">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neutral-800 to-neutral-950 text-white shadow-sm">
                <Workflow className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight text-neutral-900">
                  LostCity OSRS Model Pipeline
                </h1>
                <p className="hidden truncate text-[11px] text-neutral-500 sm:block">
                  377 → OSRS upgrade · modular model selector
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {loading && !data ? (
                <Badge variant="outline" className="border-neutral-200 text-neutral-500">
                  <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-neutral-400" />
                  loading…
                </Badge>
              ) : error ? (
                <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                  <AlertTriangle className="mr-1 size-3" />
                  {error}
                </Badge>
              ) : data ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="mr-1 size-3" />
                  all stages done
                </Badge>
              ) : null}
              {data && (
                <span className="hidden font-mono text-[10px] text-neutral-400 md:inline">
                  refreshed {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              )}
              <PlayerSwitcher />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    onClick={() => setShowPalette(true)}
                    aria-label="Command palette"
                  >
                    <Search className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Command palette (Cmd+K)
                </TooltipContent>
              </Tooltip>
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    onClick={() => setShowShortcuts((s) => !s)}
                    aria-label="Keyboard shortcuts"
                  >
                    <Keyboard className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Keyboard shortcuts (press ?)
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* ---------- Tab navigation (pill-style with gradient underline) ---------- */}
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <nav className="flex gap-1 overflow-x-auto" aria-label="Main navigation">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
                          active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                        )}
                      >
                        <span className={cn(active && tabIconColor(t.accent))}>{t.icon}</span>
                        {t.label}
                        <kbd className="ml-0.5 hidden rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[9px] text-neutral-400 sm:inline">
                          {t.shortcut}
                        </kbd>
                        {active && (
                          <motion.div
                            layoutId="tab-underline"
                            className={cn(
                              "absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r",
                              t.underline
                            )}
                            transition={{ type: "spring", stiffness: 400, damping: 32 }}
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Switch to {t.label} (press {t.shortcut})
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>
          </div>
        </header>

        {/* ---------- Main ---------- */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {tab === "overview" && <OverviewTab />}
              {tab === "configuration" && <ConfigurationTab />}
              {tab === "deps" && <DependencyGraphTab />}
              {tab === "models" && <ModelsTab />}
              {tab === "debug" && <DebugTab />}
              {tab === "play" && <PlayTab />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* ---------- Footer (sticky to bottom) ---------- */}
        <footer className="mt-auto border-t border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-4 text-xs text-neutral-500 sm:flex-row sm:items-center sm:px-6">
            <div className="flex items-center gap-2">
              <Cpu className="size-3.5" />
              <span>
                Worklog:{" "}
                <code className="font-mono text-neutral-700">/home/z/my-project/worklog.md</code>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Engine: <code className="font-mono text-neutral-700">lostcity/engine</code>
              </span>
              <span>
                Content: <code className="font-mono text-neutral-700">lostcity/content</code>
              </span>
              <span>
                Client: <code className="font-mono text-neutral-700">lostcity/client</code>
              </span>
              <span className="hidden items-center gap-1 lg:flex">
                <Keyboard className="size-3" />
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">1</kbd>
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">2</kbd>
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">3</kbd>
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">4</kbd>
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">5</kbd>
                <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px]">6</kbd>
                <span className="ml-1 text-neutral-400">switch tabs</span>
              </span>
            </div>
          </div>
        </footer>

        {/* ---------- Keyboard shortcuts overlay ---------- */}
        <AnimatePresence>
          {showShortcuts && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 bg-neutral-900/30 backdrop-blur-sm"
                onClick={() => setShowShortcuts(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl"
                role="dialog"
                aria-label="Keyboard shortcuts"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Keyboard className="size-5 text-neutral-700" />
                  <h2 className="text-base font-semibold text-neutral-900">
                    Keyboard shortcuts
                  </h2>
                </div>
                <dl className="space-y-2 text-sm">
                  {[
                    { key: "1", desc: "Switch to Overview tab" },
                    { key: "2", desc: "Switch to Configuration tab" },
                    { key: "3", desc: "Switch to Dependency graph tab" },
                    { key: "⌘K", desc: "Open command palette" },
                    { key: "Esc", desc: "Close drawer / dialog / overlay" },
                    { key: "?", desc: "Toggle this shortcuts overlay" },
                  ].map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-3">
                      <dt className="text-neutral-600">{s.desc}</dt>
                      <dd>
                        <kbd className="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-0.5 font-mono text-xs font-semibold text-neutral-800 shadow-sm">
                          {s.key}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[11px] text-neutral-400">
                  Shortcuts are disabled while typing in inputs.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() => setShowShortcuts(false)}
                >
                  Close
                </Button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ---------- Command palette (Cmd+K) ---------- */}
        <CommandPaletteWrapper
          open={showPalette}
          onOpenChange={setShowPalette}
          onSwitchTab={setTab}
        />

        {/* ---------- Onboarding tour (first-visit) ---------- */}
        <OnboardingTour />
      </div>
    </PlayerProvider>
    </ThemeProvider>
  );
}

/**
 * Wraps the CommandPalette with the player list + action handlers.
 * Kept separate so the main Home component doesn't need all the
 * preference-update logic.
 */
function CommandPaletteWrapper({
  open,
  onOpenChange,
  onSwitchTab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchTab: (tab: TabId) => void;
}) {
  const { data: playerList } = usePlayerList();
  const { data: variantsData } = useVariants();
  const { playerId, setPlayerId } = usePlayerId();

  const handleReset = async () => {
    try {
      await fetch(`/api/player-preferences?playerId=${playerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "clearAll" }),
      });
    } catch {
      // silent
    }
  };

  const handleExport = async () => {
    try {
      const r = await fetch(`/api/player-preferences?playerId=${playerId}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const pref = await r.json();
      const blob = new Blob(
        [JSON.stringify(
          {
            playerId: pref.playerId,
            eraPreset: pref.eraPreset,
            npcOverrides: pref.npcOverrides,
            regionOverrides: pref.regionOverrides,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        )],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `player-${pref.playerId}-preferences.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    }
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      players={playerList?.players ?? []}
      variants={variantsData?.variants ?? []}
      onSwitchPlayer={setPlayerId}
      onSwitchTab={onSwitchTab}
      onResetPreferences={handleReset}
      onExportPreferences={handleExport}
      onShowShortcuts={() => {
        // Trigger the shortcuts overlay — use the global handler by dispatching "?" key
        const ev = new KeyboardEvent("keydown", { key: "?", bubbles: true });
        window.dispatchEvent(ev);
      }}
      onShowTour={() => {
        // Re-open the onboarding tour
        window.dispatchEvent(new CustomEvent("lostcity-reopen-tour"));
      }}
      onOpenNpc={(debugname) => {
        // Stash the requested dep map + switch to the Dependency graph tab
        try {
          sessionStorage.setItem("pendingDepMap", debugname);
        } catch {
          // ignore
        }
        onSwitchTab("deps");
      }}
    />
  );
}

function tabIconColor(accent: "amber" | "emerald" | "rose" | "violet" | "blue" | "cyan"): string {
  switch (accent) {
    case "amber":
      return "text-amber-600";
    case "emerald":
      return "text-emerald-600";
    case "rose":
      return "text-rose-600";
    case "violet":
      return "text-violet-600";
    case "blue":
      return "text-blue-600";
    case "cyan":
      return "text-cyan-600";
  }
}
