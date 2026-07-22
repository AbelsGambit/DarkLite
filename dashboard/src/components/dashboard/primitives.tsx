"use client";

import * as React from "react";
import { motion, useInView, animate } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { AccentColor } from "./types";

// ---------- Accent color system (NO indigo/blue) ----------
export const ACCENT_TEXT: Record<AccentColor, string> = {
  amber: "text-amber-700",
  rose: "text-rose-700",
  emerald: "text-emerald-700",
  orange: "text-orange-700",
  teal: "text-teal-700",
  lime: "text-lime-700",
  purple: "text-purple-700",
  neutral: "text-neutral-700",
};

export const ACCENT_BG: Record<AccentColor, string> = {
  amber: "bg-amber-50",
  rose: "bg-rose-50",
  emerald: "bg-emerald-50",
  orange: "bg-orange-50",
  teal: "bg-teal-50",
  lime: "bg-lime-50",
  purple: "bg-purple-50",
  neutral: "bg-neutral-100",
};

export const ACCENT_BG_SOFT: Record<AccentColor, string> = {
  amber: "bg-amber-50/60",
  rose: "bg-rose-50/60",
  emerald: "bg-emerald-50/60",
  orange: "bg-orange-50/60",
  teal: "bg-teal-50/60",
  lime: "bg-lime-50/60",
  purple: "bg-purple-50/60",
  neutral: "bg-neutral-50",
};

export const ACCENT_GRADIENT: Record<AccentColor, string> = {
  amber: "from-amber-300 to-amber-100",
  rose: "from-rose-300 to-rose-100",
  emerald: "from-emerald-300 to-emerald-100",
  orange: "from-orange-300 to-orange-100",
  teal: "from-teal-300 to-teal-100",
  lime: "from-lime-300 to-lime-100",
  purple: "from-purple-300 to-purple-100",
  neutral: "from-neutral-300 to-neutral-100",
};

export const ACCENT_GRADIENT_FADE: Record<AccentColor, string> = {
  amber: "from-amber-400 to-transparent",
  rose: "from-rose-400 to-transparent",
  emerald: "from-emerald-400 to-transparent",
  orange: "from-orange-400 to-transparent",
  teal: "from-teal-400 to-transparent",
  lime: "from-lime-400 to-transparent",
  purple: "from-purple-400 to-transparent",
  neutral: "from-neutral-400 to-transparent",
};

export const ACCENT_RING: Record<AccentColor, string> = {
  amber: "ring-amber-300",
  rose: "ring-rose-300",
  emerald: "ring-emerald-300",
  orange: "ring-orange-300",
  teal: "ring-teal-300",
  lime: "ring-lime-300",
  purple: "ring-purple-300",
  neutral: "ring-neutral-300",
};

export const ACCENT_RING_STRONG: Record<AccentColor, string> = {
  amber: "ring-amber-400",
  rose: "ring-rose-400",
  emerald: "ring-emerald-400",
  orange: "ring-orange-400",
  teal: "ring-teal-400",
  lime: "ring-lime-400",
  purple: "ring-purple-400",
  neutral: "ring-neutral-400",
};

export const ACCENT_DOT: Record<AccentColor, string> = {
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
  orange: "bg-orange-500",
  teal: "bg-teal-500",
  lime: "bg-lime-600",
  purple: "bg-purple-500",
  neutral: "bg-neutral-500",
};

export const ACCENT_BORDER: Record<AccentColor, string> = {
  amber: "border-amber-200",
  rose: "border-rose-200",
  emerald: "border-emerald-200",
  orange: "border-orange-200",
  teal: "border-teal-200",
  lime: "border-lime-200",
  purple: "border-purple-200",
  neutral: "border-neutral-200",
};

export const ACCENT_HEX: Record<AccentColor, string> = {
  amber: "#f59e0b",
  rose: "#f43f5e",
  emerald: "#10b981",
  orange: "#f97316",
  teal: "#14b8a6",
  lime: "#84cc16",
  purple: "#a855f7",
  neutral: "#737373",
};

// ---------- CountUp number animation ----------
export function CountUp({
  value,
  duration = 0.8,
  format = true,
  className,
}: {
  value: number;
  duration?: number;
  format?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration]);

  const rounded = Math.round(display);
  return (
    <span ref={ref} className={className}>
      {format ? rounded.toLocaleString() : rounded}
    </span>
  );
}

// ---------- Shimmer skeleton (gradient, not gray box) ----------
export function ShimmerSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-neutral-100", className)}>
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/80 to-transparent"
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
      />
    </div>
  );
}

// ---------- Section header (with gradient accent line under) ----------
export function SectionHeader({
  icon,
  title,
  accent = "neutral",
  right,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  accent?: AccentColor;
  right?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md ring-1",
            ACCENT_BG[accent],
            ACCENT_TEXT[accent],
            ACCENT_RING[accent]
          )}
        >
          {icon}
        </span>
        <h3 className="whitespace-nowrap text-sm font-semibold uppercase tracking-wider text-neutral-700">
          {title}
        </h3>
        <div className={cn("h-px min-w-12 flex-1 bg-gradient-to-r", ACCENT_GRADIENT_FADE[accent])} />
      </div>
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

// ---------- Empty state card ----------
export function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  cta?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed border-neutral-300 bg-neutral-50/60">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200">
          {icon}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-neutral-700">{title}</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-neutral-500">{description}</p>
        </div>
        {cta}
      </CardContent>
    </Card>
  );
}

// ---------- Staggered motion wrapper ----------
export const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// ---------- Separator with gradient ----------
export function GradientSeparator({ accent = "neutral" }: { accent?: AccentColor }) {
  return (
    <div
      className={cn(
        "h-px w-full bg-gradient-to-r",
        ACCENT_GRADIENT_FADE[accent]
      )}
    />
  );
}

export { Separator };
