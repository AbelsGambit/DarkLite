"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  SlidersHorizontal,
  GitBranch,
  LayoutDashboard,
  Keyboard,
  Command,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Step = {
  id: string;
  title: string;
  body: React.ReactNode;
  icon: React.ReactNode;
  accent: "amber" | "emerald" | "rose" | "purple";
};

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to the LostCity OSRS Model Pipeline",
    body: (
      <>
        <p>
          This dashboard visualizes a patch pipeline that lets the LostCity
          377-branch engine render newer OSRS models — with backwards
          compatibility preserved and a per-player variant selector.
        </p>
        <p className="mt-2 text-neutral-500">
          The underlying engine has 27 new TypeScript files (~13.5k lines)
          implementing OSRS model/anim/seq/npc decoders, a dependency tracer,
          an OSRS cache reader, a content-folder writer, and a modular variant
          registry. Two pilots (Tormented Demon 75/75, Kalphite Queen 124/124)
          pass.
        </p>
      </>
    ),
    icon: <Sparkles className="size-5" />,
    accent: "purple",
  },
  {
    id: "overview",
    title: "Overview tab — pipeline status",
    body: (
      <>
        <p>
          The <strong>Overview</strong> tab (press <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[10px]">1</kbd>) shows the full pipeline:
          6 stages (Decode → Trace → Pack → Write → Register → Pilot), pilot
          results, dependency map summaries, the variant registry, and a
          statistics card with aggregate charts.
        </p>
        <p className="mt-2 text-neutral-500">
          The <strong>live resolution card</strong> in the hero shows how the
          currently-selected player&apos;s preferences resolve across all NPCs
          (how many use OSRS vs legacy).
        </p>
      </>
    ),
    icon: <LayoutDashboard className="size-5" />,
    accent: "amber",
  },
  {
    id: "configuration",
    title: "Configuration tab — pick your era",
    body: (
      <>
        <p>
          The <strong>Configuration</strong> tab (press <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[10px]">2</kbd>) is where players choose
          which model era they want.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-neutral-600">
          <li><strong>Basic mode</strong>: pick one of 4 era presets (2005 / 2007 / All OSRS / Mixed).</li>
          <li><strong>Advanced mode</strong>: toggle individual NPCs between legacy and OSRS, with search + filters + bulk selection.</li>
          <li><strong>Region overrides</strong>: force a variant for all NPCs in a specific region.</li>
        </ul>
        <p className="mt-2 text-neutral-500">
          Click any NPC row to open a detail drawer with its metadata + dep map link.
        </p>
      </>
    ),
    icon: <SlidersHorizontal className="size-5" />,
    accent: "emerald",
  },
  {
    id: "depgraph",
    title: "Dependency graph — trace the chain",
    body: (
      <>
        <p>
          The <strong>Dependency graph</strong> tab (press <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[10px]">3</kbd>) shows an interactive
          radial view of each NPC&apos;s dependency map.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-neutral-600">
          <li>Zoom + pan with mouse, search nodes by name.</li>
          <li>Click a node to see its details + neighbors.</li>
          <li>Missing deps (red dashed) show what hasn&apos;t been ported yet.</li>
          <li>Recently-viewed dep maps appear as quick-switch pills.</li>
          <li>Edit history timeline at the bottom lets you undo changes.</li>
        </ul>
      </>
    ),
    icon: <GitBranch className="size-5" />,
    accent: "rose",
  },
  {
    id: "shortcuts",
    title: "Power-user shortcuts",
    body: (
      <>
        <p>A few shortcuts to speed up your workflow:</p>
        <ul className="mt-2 space-y-1.5 text-sm text-neutral-600">
          <li className="flex items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">1</kbd>
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">2</kbd>
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">3</kbd>
            <span>— switch tabs</span>
          </li>
          <li className="flex items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">⌘K</kbd>
            <span>— command palette (jump to anything)</span>
          </li>
          <li className="flex items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">?</kbd>
            <span>— show all shortcuts</span>
          </li>
          <li className="flex items-center gap-2">
            <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">Esc</kbd>
            <span>— close any dialog/drawer</span>
          </li>
        </ul>
        <p className="mt-3 text-neutral-500">
          The header has a player switcher (P1/P2/P3), dark mode toggle, and a
          search button that opens the command palette.
        </p>
      </>
    ),
    icon: <Keyboard className="size-5" />,
    accent: "purple",
  },
];

const ACCENT_CLASSES = {
  amber: "from-amber-50 to-orange-50 text-amber-700 ring-amber-200 dark:from-amber-950/40 dark:to-orange-950/40 dark:text-amber-300 dark:ring-amber-800",
  emerald: "from-emerald-50 to-teal-50 text-emerald-700 ring-emerald-200 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  rose: "from-rose-50 to-orange-50 text-rose-700 ring-rose-200 dark:from-rose-950/40 dark:to-orange-950/40 dark:text-rose-300 dark:ring-rose-800",
  purple: "from-purple-50 to-fuchsia-50 text-purple-700 ring-purple-200 dark:from-purple-950/40 dark:to-fuchsia-950/40 dark:text-purple-300 dark:ring-purple-800",
};

const STORAGE_KEY = "lostcity-dashboard-tour-completed";

export function OnboardingTour({ forceOpen = false }: { forceOpen?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  // Open on first visit (no localStorage flag) OR when forceOpen is true
  React.useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    try {
      const completed = localStorage.getItem(STORAGE_KEY);
      if (!completed) {
        // Small delay so it doesn't fight with initial page render
        const t = setTimeout(() => setOpen(true), 800);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage unavailable
    }
  }, [forceOpen]);

  // Listen for the reopen-tour event (from command palette / help menu)
  React.useEffect(() => {
    const handler = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("lostcity-reopen-tour", handler);
    return () => window.removeEventListener("lostcity-reopen-tour", handler);
  }, []);

  const handleClose = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else handleClose();
  };

  const handlePrev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] bg-neutral-900/40 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Tour card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed left-1/2 top-1/2 z-[70] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-label="Onboarding tour"
          >
            {/* Progress bar */}
            <div className="h-1 w-full bg-neutral-100 dark:bg-neutral-800">
              <motion.div
                className="h-full bg-gradient-to-r from-purple-400 to-fuchsia-400"
                initial={{ width: 0 }}
                animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              aria-label="Close tour"
            >
              <X className="size-4" />
            </button>

            {/* Content */}
            <div className="p-6">
              {/* Icon + step counter */}
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`flex size-12 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ${ACCENT_CLASSES[current.accent]}`}
                >
                  {current.icon}
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Step {step + 1} of {STEPS.length}
                  </span>
                  <Badge
                    variant="outline"
                    className="w-fit border-neutral-200 bg-neutral-50 font-mono text-[9px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    {current.id}
                  </Badge>
                </div>
              </div>

              {/* Title */}
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {current.title}
              </h2>

              {/* Body */}
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                {current.body}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-3 dark:border-neutral-700">
              <div className="flex gap-1">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStep(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step
                        ? "w-6 bg-purple-500"
                        : i < step
                        ? "w-1.5 bg-purple-300 dark:bg-purple-700"
                        : "w-1.5 bg-neutral-200 dark:bg-neutral-700"
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePrev}
                    className="gap-1 text-xs"
                  >
                    <ChevronLeft className="size-3.5" />
                    Back
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="gap-1 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white hover:from-purple-600 hover:to-fuchsia-600"
                >
                  {isLast ? (
                    <>
                      <Check className="size-3.5" />
                      Got it
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="size-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Skip link */}
            {!isLast && (
              <button
                type="button"
                onClick={handleClose}
                className="absolute bottom-3 left-6 text-[10px] text-neutral-400 underline-offset-2 hover:text-neutral-600 hover:underline dark:hover:text-neutral-300"
              >
                Skip tour
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook to let other components (e.g. the command palette) re-open the tour.
 */
export function useReopenTour() {
  return React.useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    // Dispatch a custom event the OnboardingTour listens for
    window.dispatchEvent(new CustomEvent("lostcity-reopen-tour"));
  }, []);
}
