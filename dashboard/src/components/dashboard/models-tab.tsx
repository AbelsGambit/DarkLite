"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Download,
  Package,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Skull,
  Users,
  Package2,
  MapPin,
  Sword,
  Info,
  Lock,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CrcState {
  enabled: boolean;
  unknown: boolean;
  line63: string;
  description: string;
}

interface ModStatus {
  tdImported: boolean;
  tdModelsDownloaded: boolean;
  tdNpcId: number;
  tdNpcName: string;
  tdModels: { id: number; packId: number; name: string }[];
}

export function ModelsTab() {
  const [crcState, setCrcState] = React.useState<CrcState | null>(null);
  const [modStatus, setModStatus] = React.useState<ModStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchCrcState = React.useCallback(async () => {
    try {
      const res = await fetch("/api/crc-bypass");
      if (!res.ok) throw new Error("Failed to fetch CRC state");
      const data = await res.json();
      setCrcState(data);
    } catch (err) {
      toast.error("Failed to check CRC bypass state");
    }
  }, []);

  const fetchModStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/models-import");
      if (!res.ok) throw new Error("Failed to fetch mod status");
      const data = await res.json();
      setModStatus(data);
    } catch (err) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchCrcState();
    fetchModStatus();
  }, [fetchCrcState, fetchModStatus]);

  const handleToggleCrc = async (enabled: boolean) => {
    setBusy("crc");
    try {
      const res = await fetch("/api/crc-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to toggle CRC bypass");
      } else {
        toast.success(`CRC bypass ${enabled ? "ENABLED" : "DISABLED"}`, {
          description: enabled ? "Modified cache files will now be accepted" : "Standard integrity checks restored",
        });
        setCrcState(data);
      }
    } catch (err) {
      toast.error("Failed to toggle CRC bypass", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadTd = async () => {
    setBusy("download-td");
    try {
      const res = await fetch("/api/github-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download_td" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to download TD files");
      } else {
        const succeeded = data.results.filter((r: any) => r.success).length;
        const failed = data.results.filter((r: any) => !r.success).length;
        toast.success(`Downloaded ${succeeded} TD file(s)`, {
          description: failed > 0 ? `${failed} file(s) failed` : "All files downloaded from GitHub",
        });
        await fetchModStatus();
      }
    } catch (err) {
      toast.error("Failed to download TD files", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleApplyTd = async () => {
    setBusy("apply-td");
    try {
      const res = await fetch("/api/models-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", modId: "td" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.message || "Failed to import TD");
      } else {
        toast.success("Tormented Demon imported!", {
          description: data.message,
        });
        await fetchModStatus();
      }
    } catch (err) {
      toast.error("Failed to import TD", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveTd = async () => {
    setBusy("remove-td");
    try {
      const res = await fetch("/api/models-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", modId: "td" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.message || "Failed to remove TD");
      } else {
        toast.success("TD import removed", { description: data.message });
        await fetchModStatus();
      }
    } catch (err) {
      toast.error("Failed to remove TD", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const modsEnabled = crcState?.enabled === true;
  const modsUnknown = crcState?.unknown === true;
  const canMod = modsEnabled || modsUnknown;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <Package className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Models</h2>
            <p className="text-sm text-muted-foreground">Import and manage model modifications</p>
          </div>
        </motion.div>

        {/* CRC Bypass Section */}
        <Card className="border-2 border-amber-200 dark:border-amber-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {crcState?.unknown ? (
                  <ShieldX className="size-6 text-red-500" />
                ) : modsEnabled ? (
                  <ShieldAlert className="size-6 text-amber-500" />
                ) : (
                  <ShieldCheck className="size-6 text-green-500" />
                )}
                <div>
                  <CardTitle>Bypass CRC Checks</CardTitle>
                  <CardDescription className={crcState?.unknown ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                    {crcState?.description || "Checking CRC state..."}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {busy === "crc" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                <Switch
                  checked={modsEnabled}
                  onCheckedChange={handleToggleCrc}
                  disabled={busy === "crc"}
                />
                <Label className="text-sm font-medium">
                  {crcState?.unknown ? "Unknown" : modsEnabled ? "ON" : "OFF"}
                </Label>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Greyed-out mod section with hover tooltip */}
        <div
          className={canMod ? "" : "pointer-events-none opacity-40"}
        >
          {!canMod && (
            <div className="relative">
              <div
                className="absolute inset-0 z-10 cursor-not-allowed"
                onMouseEnter={(e) => {
                  // Show floating tooltip
                  const el = e.currentTarget as HTMLElement;
                  el.style.cursor = "not-allowed";
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute inset-0 z-20" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs font-medium">Modifications require CRC Bypass</p>
                  <p className="text-xs text-muted-foreground">Enable at the top of this tab</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Monsters Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Skull className="size-4 text-red-500" />
                <CardTitle>Monsters</CardTitle>
              </div>
              <CardDescription>Enemy NPCs and bosses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* TD Mod Card */}
              <div className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                      <Skull className="size-5" />
                    </div>
                    <div>
                      <div className="font-semibold">Tormented Demon</div>
                      <div className="text-xs text-muted-foreground">
                        NPC ID: {modStatus?.tdNpcId ?? 3852} | Models: 53287, 53285, 6318 | Combat: 450
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {modStatus?.tdImported ? (
                      <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                        <CheckCircle2 className="mr-1 size-3" />
                        Imported
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <XCircle className="mr-1 size-3" />
                        Not imported
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* Step 1: Download models */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTd}
                    disabled={busy !== null || modStatus?.tdModelsDownloaded}
                    className="gap-2"
                  >
                    {busy === "download-td" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    {modStatus?.tdModelsDownloaded ? "Models Downloaded" : "Download Models"}
                  </Button>

                  {/* Step 2: Apply import */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleApplyTd}
                    disabled={busy !== null || !modStatus?.tdModelsDownloaded || modStatus?.tdImported}
                    className="gap-2"
                  >
                    {busy === "apply-td" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Package2 className="size-3.5" />
                    )}
                    Apply Import
                  </Button>

                  {/* Remove */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveTd}
                    disabled={busy !== null || !modStatus?.tdImported}
                    className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
                  >
                    {busy === "remove-td" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    Remove
                  </Button>
                </div>

                {!modStatus?.tdModelsDownloaded && (
                  <div className="mt-3 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                    <Info className="mr-1 inline size-3" />
                    Step 1: Download model files from GitHub. Step 2: Apply the import to register the NPC.
                    After applying, run <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/40">bun run build</code> from the engine folder.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Utility NPCs Section */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="size-4 text-blue-500" />
                <CardTitle>Utility NPCs</CardTitle>
              </div>
              <CardDescription>Shops, bankers, and service NPCs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                No utility NPC mods available yet
              </div>
            </CardContent>
          </Card>

          {/* Misc NPCs Section */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package2 className="size-4 text-violet-500" />
                <CardTitle>Misc NPCs</CardTitle>
              </div>
              <CardDescription>Other NPCs not fitting other categories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                No misc NPC mods available yet
              </div>
            </CardContent>
          </Card>

          {/* Objs Section */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sword className="size-4 text-amber-500" />
                <CardTitle>Objs (Items)</CardTitle>
              </div>
              <CardDescription>Item model modifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                No item mods available yet
              </div>
            </CardContent>
          </Card>

          {/* Locs Section */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-green-500" />
                <CardTitle>Locs (Objects)</CardTitle>
              </div>
              <CardDescription>World object model modifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground">
                No location mods available yet
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lock indicator when mods are disabled */}
        {!canMod && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700 shadow-lg dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Lock className="size-4" />
            CRC Bypass required to mod
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// Helper hook
function useState<T>(initial: T): [T, (v: T) => void] {
  return React.useState(initial);
}
