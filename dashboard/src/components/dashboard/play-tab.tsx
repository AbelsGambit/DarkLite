"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Play,
  Server,
  Trash2,
  Square,
  RefreshCw,
  Terminal,
  FolderTree,
  HardDrive,
  CheckCircle2,
  AlertCircle,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface LauncherStatus {
  processes: { key: string; pid: number; running: boolean }[];
  engineDir: string;
  clientDir: string;
  platform: string;
  isWindows: boolean;
}

export function PlayTab() {
  const [status, setStatus] = React.useState<LauncherStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [output, setOutput] = React.useState<{ action: string; result: any } | null>(null);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/launcher");
      if (!res.ok) throw new Error("Failed to fetch launcher status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      // Silent fail — status will just be null
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleAction = async (action: string, label: string) => {
    setBusy(action);
    setOutput(null);
    try {
      const res = await fetch("/api/launcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setOutput({ action, result: data });

      if (res.ok && data.success !== false) {
        toast.success(label + " — success", {
          description: data.message || "Command completed",
        });
      } else {
        toast.error(label + " — failed", {
          description: data.error || data.message || "Unknown error",
        });
      }

      await fetchStatus();
    } catch (err) {
      toast.error(label + " — error", {
        description: (err as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  const isRunning = (key: string) => {
    return status?.processes.some((p) => p.key === key && p.running) ?? false;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
          <Play className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Play</h2>
          <p className="text-sm text-muted-foreground">
            Build and launch the game with one click
          </p>
        </div>
      </motion.div>

      {/* Main Play button */}
      <Card className="border-2 border-emerald-200 dark:border-emerald-800">
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-4">
            <Button
              size="lg"
              className="h-20 w-full max-w-md gap-3 bg-emerald-600 text-lg font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-700"
              onClick={() => handleAction("play", "Play")}
              disabled={busy !== null}
            >
              {busy === "play" ? (
                <RefreshCw className="size-6 animate-spin" />
              ) : (
                <Play className="size-6" />
              )}
              Play
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Builds and launches the game client
              <br />
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {status?.isWindows ? "gradlew build && gradlew run" : "./gradlew build && ./gradlew run"}
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Build Game Server */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-blue-500" />
              <CardTitle>Build Game Server</CardTitle>
            </div>
            {isRunning("engine-start") && (
              <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                <span className="mr-1 size-2 animate-pulse rounded-full bg-green-500" />
                Running
              </Badge>
            )}
          </div>
          <CardDescription>
            Starts the game server (includes <code className="rounded bg-muted px-1">bun install</code> if needed)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => handleAction("build_game", "Build Game")}
            disabled={busy !== null}
          >
            {busy === "build_game" ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Server className="size-4" />
            )}
            Build & Start Server
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1">bun start</code> from <code className="rounded bg-muted px-1">engine/</code>
          </p>
        </CardContent>
      </Card>

      {/* Debug / Dev buttons */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-amber-500" />
            <CardTitle>Debug / Dev</CardTitle>
          </div>
          <CardDescription>
            Clean builds and maintenance commands
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Clean Build */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="flex-1 gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
              onClick={() => handleAction("clean_build", "Clean Build")}
              disabled={busy !== null}
            >
              {busy === "clean_build" ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Clean Build
            </Button>
            <div className="flex-1 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">npm run clean && bun start</code>
              <br />
              Wipes cache + <code className="rounded bg-muted px-1">.file_store_32</code> + restarts
            </div>
          </div>

          <Separator />

          {/* Clean file_store_32 only */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => handleAction("clean_file_store", "Clean File Store")}
              disabled={busy !== null}
            >
              {busy === "clean_file_store" ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <HardDrive className="size-3.5" />
              )}
              Clean .file_store_32
            </Button>
            <span className="text-xs text-muted-foreground">
              Wipes client settings cache only
            </span>
          </div>

          {/* Stop all */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
              onClick={() => handleAction("stop_all", "Stop All")}
              disabled={busy !== null || (status?.processes.length ?? 0) === 0}
            >
              <Square className="size-3.5" />
              Stop All Processes
            </Button>
            <span className="text-xs text-muted-foreground">
              Kills all running build/server processes
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Project paths */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderTree className="size-4 text-violet-500" />
            <CardTitle>Project Paths</CardTitle>
          </div>
          <CardDescription>
            The launcher operates on these directories
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-2 text-sm">
            <span className="font-medium">Engine</span>
            <code className="font-mono text-xs">{status?.engineDir || "/home/z/my-project/lostcity/engine"}</code>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-2 text-sm">
            <span className="font-medium">Client</span>
            <code className="font-mono text-xs">{status?.clientDir || "/home/z/my-project/lostcity/client"}</code>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-2 text-sm">
            <span className="font-medium">Platform</span>
            <code className="font-mono text-xs">{status?.platform || process.platform} {status?.isWindows ? "(Windows)" : ""}</code>
          </div>
        </CardContent>
      </Card>

      {/* Output console */}
      {output && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Command Output</CardTitle>
              </div>
              {output.result.success !== false ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : (
                <AlertCircle className="size-4 text-red-500" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48 rounded-lg border border-border bg-neutral-950 p-3">
              <pre className="whitespace-pre-wrap font-mono text-xs text-green-400">
                {output.result.output || output.result.message || JSON.stringify(output.result, null, 2)}
                {output.result.clean?.output && "\n\n--- Clean Output ---\n" + output.result.clean.output}
                {output.result.fileStore?.message && "\n\n--- File Store ---\n" + output.result.fileStore.message}
                {output.result.start?.output && "\n\n--- Start Output ---\n" + output.result.start.output}
                {output.result.build?.output && "\n\n--- Build Output ---\n" + output.result.build.output}
                {output.result.run?.output && "\n\n--- Run Output ---\n" + output.result.run.output}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Running processes */}
      {status && status.processes.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
              <CardTitle className="text-base">Running Processes</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {status.processes.map((p) => (
                <div key={p.key} className="flex items-center justify-between rounded border border-border p-2 text-sm">
                  <span className="font-mono">{p.key}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">PID: {p.pid}</Badge>
                    {p.running && (
                      <Badge variant="outline" className="border-green-500 text-green-700">
                        Running
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
