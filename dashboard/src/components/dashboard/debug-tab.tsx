"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Bug,
  MapPin,
  Terminal,
  RefreshCw,
  Save,
  Search,
  Zap,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DebugNpcState {
  mapFile: string;
  mapSize: number;
  hansSpawnsFound: number;
  originalHansCount: number;
  tormentedDemonNpcId: number | null;
  hasBackup: boolean;
  spawns: { offset: number; coord: number; npcId: number; count: number }[];
}

export function DebugTab() {
  const [state, setState] = React.useState<DebugNpcState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [npcInput, setNpcInput] = React.useState("osrs_tormented_demon");
  const [applying, setApplying] = React.useState(false);
  const [hansNpcId, setHansNpcId] = React.useState("3852");
  const [adminEnabled, setAdminEnabled] = React.useState(false);
  const [godMode, setGodMode] = React.useState(false);

  const fetchState = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/debug-npc");
      if (!res.ok) throw new Error("Failed to fetch debug NPC state");
      const data = await res.json();
      setState(data);
    } catch (err) {
      toast.error("Failed to load debug NPC state", {
        description: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleSetDebugNpc = async () => {
    if (!npcInput.trim()) {
      toast.error("Enter an NPC ID or name");
      return;
    }
    setApplying(true);
    try {
      // Try as number first, then as name
      const asNum = parseInt(npcInput);
      const body =
        !isNaN(asNum) && String(asNum) === npcInput.trim()
          ? { action: "set_debug_npc", npcId: asNum }
          : { action: "set_debug_npc", npcName: npcInput.trim() };

      const res = await fetch("/api/debug-npc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to set debug NPC");
      } else {
        toast.success("Debug NPC set!", {
          description: data.message,
        });
        await fetchState();
      }
    } catch (err) {
      toast.error("Failed to set debug NPC", {
        description: (err as Error).message,
      });
    } finally {
      setApplying(false);
    }
  };

  const handleRestore = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/debug-npc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to restore");
      } else {
        toast.success("Map restored!", {
          description: data.message,
        });
        await fetchState();
      }
    } catch (err) {
      toast.error("Failed to restore", {
        description: (err as Error).message,
      });
    } finally {
      setApplying(false);
    }
  };

  const handleSetHansNpc = async () => {
    const npcId = parseInt(hansNpcId);
    if (isNaN(npcId)) {
      toast.error("Enter a valid NPC ID number");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch("/api/debug-npc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_debug_npc", npcId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to set NPC");
      } else {
        toast.success(`Hans replaced with NPC ${npcId}`, { description: data.message });
        await fetchState();
      }
    } catch (err) {
      toast.error("Failed", { description: (err as Error).message });
    } finally {
      setApplying(false);
    }
  };

  const handleRestoreHans = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/debug-npc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to restore");
      } else {
        toast.success("Hans restored", { description: data.message });
        await fetchState();
      }
    } catch (err) {
      toast.error("Failed", { description: (err as Error).message });
    } finally {
      setApplying(false);
    }
  };

  const handleToggleAdmin = (enabled: boolean) => {
    setAdminEnabled(enabled);
    if (enabled) {
      toast.success("Admin account enabled", {
        description: "Login with admin / admin (requires build + restart)",
      });
    } else {
      setGodMode(false);
      toast.info("Admin account disabled");
    }
  };

  const tdId = state?.tormentedDemonNpcId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
          <Bug className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Debug Settings</h2>
          <p className="text-sm text-muted-foreground">
            Quick NPC debugging tools — swap Hans for any NPC in Lumbridge (m50_50.jm2)
          </p>
        </div>
      </motion.div>

      {/* Simple NPC Debug */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-violet-500" />
              <CardTitle>Simple NPC Debug</CardTitle>
            </div>
            {tdId !== null && tdId !== undefined && (
              <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-400">
                TD = NPC {tdId}
              </Badge>
            )}
          </div>
          <CardDescription>
            Replaces Hans (NPC 0) spawns in <code className="rounded bg-muted px-1 py-0.5 text-xs">m50_50.jm2</code> (Lumbridge)
            with the debug NPC. After applying, run <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run build</code> in
            the engine folder, then launch the game and visit Lumbridge to see the debug NPC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current state */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Search className="size-3.5 text-muted-foreground" />
              Current Map State
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" />
                Loading...
              </div>
            ) : state ? (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Hans Spawns</div>
                  <div className="font-mono font-semibold">{state.hansSpawnsFound}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Original Hans</div>
                  <div className="font-mono font-semibold">{state.originalHansCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Map Size</div>
                  <div className="font-mono font-semibold">{(state.mapSize / 1024).toFixed(1)} KB</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Backup Exists</div>
                  <div className="font-mono font-semibold">{state.hasBackup ? "Yes" : "No"}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Failed to load</div>
            )}
          </div>

          {/* NPC input */}
          <div className="space-y-2">
            <Label htmlFor="npc-input" className="text-sm font-medium">
              Debug NPC (ID or name)
            </Label>
            <div className="flex gap-2">
              <Input
                id="npc-input"
                value={npcInput}
                onChange={(e) => setNpcInput(e.target.value)}
                placeholder="osrs_tormented_demon or 3852"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSetDebugNpc();
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSetDebugNpc}
                    disabled={applying}
                    className="bg-violet-600 text-white hover:bg-violet-700"
                  >
                    {applying ? (
                      <RefreshCw className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    Apply
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Replace Hans spawns with this NPC in m50_50.jm2
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter an NPC name (from <code className="rounded bg-muted px-1">npc.pack</code>) or numeric ID.
              The Tormented Demon is <code className="rounded bg-muted px-1">osrs_tormented_demon</code> (ID {tdId ?? "—"}).
            </p>
          </div>

          {/* Quick presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNpcInput("osrs_tormented_demon")}
                className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-900/20"
              >
                <Zap className="mr-1.5 size-3.5" />
                Tormented Demon
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNpcInput("0")}
              >
                Hans (0)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNpcInput("1")}
              >
                Man (1)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNpcInput("lesser_demon")}
              >
                Lesser Demon
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNpcInput("greater_demon")}
              >
                Greater Demon
              </Button>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestore}
              disabled={applying || !state?.hasBackup}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Restore Original (Hans)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchState}
              disabled={loading}
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Instructions */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-900/10">
            <div className="mb-2 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-400">
              <Terminal className="size-4" />
              Build & Run Instructions
            </div>
            <ol className="ml-4 list-decimal space-y-1 text-amber-900 dark:text-amber-200">
              <li>Click <strong>Apply</strong> to patch the map file</li>
              <li>
                Build the cache:
                <pre className="mt-1 rounded bg-amber-100 p-2 font-mono text-xs dark:bg-amber-900/30">
{`cd /home/z/my-project/lostcity/engine
bun run build`}
                </pre>
              </li>
              <li>
                Start the game server:
                <pre className="mt-1 rounded bg-amber-100 p-2 font-mono text-xs dark:bg-amber-900/30">
{`cd /home/z/my-project/lostcity/engine
bun run dev`}
                </pre>
              </li>
              <li>Launch the client and walk to Lumbridge castle courtyard</li>
              <li>The debug NPC will spawn where Hans normally walks</li>
            </ol>
          </div>

          {/* Spawn details */}
          {state && state.spawns.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Hans Spawn Locations (in current map)</Label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
                <div className="space-y-1 font-mono text-xs">
                  {state.spawns.map((s, i) => (
                    <div key={i} className="flex justify-between">
                      <span>Offset 0x{s.offset.toString(16).padStart(4, "0")}</span>
                      <span>Coord={s.coord} (x={s.coord >> 6}, z={s.coord & 0x3f})</span>
                      <span>NPC={s.npcId}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Debug Tests */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bug className="size-4 text-amber-500" />
            <CardTitle>Quick Debug Tests</CardTitle>
          </div>
          <CardDescription>
            Fast testing options — spawn any NPC where Hans walks, enable admin mode, and more
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Replace Hans with any NPC ID */}
          <div className="space-y-2">
            <Label htmlFor="hans-npc-input" className="text-sm font-medium">
              Replace Hans with NPC ID
            </Label>
            <div className="flex gap-2">
              <Input
                id="hans-npc-input"
                type="number"
                value={hansNpcId}
                onChange={(e) => setHansNpcId(e.target.value)}
                placeholder="Enter NPC ID (e.g. 3852 for TD)"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSetHansNpc();
                }}
              />
              <Button
                onClick={handleSetHansNpc}
                disabled={applying}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                {applying ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                Set
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestoreHans}
                disabled={applying}
              >
                Restore Hans
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Replaces Hans (NPC 0) at Lumbridge castle courtyard with the specified NPC ID.
              After applying, run <code className="rounded bg-muted px-1">bun run build</code> then launch the game.
            </p>
          </div>

          <Separator />

          {/* Admin Account */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Enable Debug Admin Account</Label>
                <p className="text-xs text-muted-foreground">
                  Creates an admin account: <code className="rounded bg-muted px-1">admin</code> / <code className="rounded bg-muted px-1">admin</code>
                </p>
              </div>
              <Switch
                checked={adminEnabled}
                onCheckedChange={handleToggleAdmin}
                disabled={applying}
              />
            </div>
          </div>

          {/* God Mode */}
          <div className={`space-y-2 pl-6 ${!adminEnabled ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">God Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Max stats, can&apos;t lose HP or prayer
                </p>
              </div>
              <Switch
                checked={godMode}
                onCheckedChange={setGodMode}
                disabled={!adminEnabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TD Import Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-violet-500" />
            <CardTitle>Tormented Demon Import</CardTitle>
          </div>
          <CardDescription>
            The TD has been imported from the OSRS 227 cache and registered as a LostCity NPC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tdId !== null && tdId !== undefined ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-900/10">
                <div className="flex size-10 items-center justify-center rounded-lg bg-violet-600 text-white">
                  <Bug className="size-5" />
                </div>
                <div>
                  <div className="font-semibold">Tormented Demon — NPC {tdId}</div>
                  <div className="text-xs text-muted-foreground">
                    Models: 53287, 53285, 6318 (extracted from OSRS cache idx7)
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="font-mono">osrs_tormented_demon</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">Size</div>
                  <div className="font-mono">3</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">Combat Level</div>
                  <div className="font-mono">450</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">HP</div>
                  <div className="font-mono">600</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">Attack</div>
                  <div className="font-mono">255</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-xs text-muted-foreground">Action</div>
                  <div className="font-mono">Attack</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/10">
              TD not imported yet. Run:
              <pre className="mt-2 rounded bg-amber-100 p-2 font-mono text-xs dark:bg-amber-900/30">
{`cd /home/z/my-project/lostcity/engine
bun run tools/osrs/ImportTormentedDemon.ts`}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
