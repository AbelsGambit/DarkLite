/**
 * Shared types for the dashboard subcomponents.
 * Mirrors the shapes returned by the API routes under /api/.
 */

// ---------- Pipeline status (/api/pipeline-status) ----------
export type StageInfo = {
  id: string;
  name: string;
  description: string;
  status: "done" | "in-progress" | "pending";
  files: { path: string; lines: number }[];
  totalLines: number;
};

export type PilotResult = {
  name: string;
  npcName: string;
  assertionsPassed: number;
  assertionsTotal: number;
  nodesTraced: number;
  filesWritten: number;
  packEntriesAdded: number;
  variantsRegistered: number;
  notes: string;
};

export type VariantEntry = {
  legacyNpcId: number;
  osrsNpcId: number;
  osrsDebugname: string;
  legacyDebugname: string;
  depMapPath: string;
  importedAt: string;
};

export type DepsSummary = {
  path: string;
  rootName: string;
  nodeCount: number;
  missingCount: number;
  cycleCount: number;
  nodeKinds: Record<string, number>;
};

export type PipelineStatus = {
  generatedAt: string;
  taskIds: string[];
  stages: StageInfo[];
  pilots: PilotResult[];
  variants: VariantEntry[];
  linkages: [number, number][];
  depsSummaries: DepsSummary[];
  summary: {
    totalStages: number;
    completedStages: number;
    totalFiles: number;
    totalLines: number;
    totalVariants: number;
    totalLinkages: number;
    totalDepsMaps: number;
    totalNodesTraced: number;
    totalMissingDeps: number;
  };
  nextSteps: {
    title: string;
    detail: string;
    priority: "blocking" | "high" | "medium" | "low";
  }[];
};

// ---------- Variants (/api/variants) ----------
export type EraPresetId = "05era" | "07era" | "allOSRS" | "mixed";
export type AccentColor = "amber" | "rose" | "emerald" | "orange" | "teal" | "lime" | "purple" | "neutral";

export type EraPresetInfo = {
  id: EraPresetId;
  label: string;
  subtitle: string;
  description: string;
  accent: AccentColor;
  badge: string;
  yearRange: string;
};

export type UnifiedVariant = {
  legacyNpcId: number;
  osrsNpcId: number;
  osrsDebugname: string;
  legacyDebugname: string;
  depMapPath: string;
  importedAt: string;
  demo: true;
  osrsSourceNpcId: number;
  displayName: string;
  category: "new" | "upgrade" | "boss";
  yearAdded: number;
  region?: string;
  isDemo: boolean;
  hasOsrsVariant: boolean;
  hasLegacyVariant: boolean;
};

export type LegacyOnlyNpc = {
  legacyNpcId: number;
  legacyDebugname: string;
  displayName: string;
  region: string;
};

export type VariantsResponse = {
  generatedAt: string;
  eraPresets: EraPresetInfo[];
  variants: UnifiedVariant[];
  legacyOnlyNpcs: LegacyOnlyNpc[];
  linkages: [number, number][];
  linkageGroups: number[][];
  byRegion: { region: string; variants: UnifiedVariant[] }[];
  summary: {
    totalVariants: number;
    totalLinkages: number;
    totalLegacyOnly: number;
    demoCount: number;
    realCount: number;
    newCount: number;
    upgradeCount: number;
    bossCount: number;
    regionCount: number;
  };
};

// ---------- Player preferences (/api/player-preferences) ----------
export type NpcVariant = "legacy377" | "osrs";

export type Resolution = {
  legacyNpcId: number;
  osrsNpcId: number | null;
  displayName: string;
  resolved: NpcVariant;
  source: "override" | "era-preset" | "default";
};

export type PlayerPreferencesResponse = {
  playerId: number;
  eraPreset: EraPresetId;
  npcOverrides: Record<string, NpcVariant>;
  regionOverrides: Record<string, NpcVariant>;
  favorites: number[];
  updatedAt: string;
  resolutions: Resolution[];
  summary: {
    totalOverrides: number;
    osrsResolved: number;
    legacyResolved: number;
  };
};

export type PlayerListItem = {
  playerId: number;
  eraPreset: EraPresetId;
  totalOverrides: number;
  favoritesCount: number;
  updatedAt: string | null;
};

export type PlayerListResponse = {
  players: PlayerListItem[];
};

export type PreferenceUpdateBody =
  | { action: "setEra"; eraPreset: EraPresetId }
  | { action: "setNpcOverride"; npcId: number; variant: NpcVariant }
  | { action: "clearNpcOverride"; npcId: number }
  | { action: "clearAll" }
  | { action: "replace"; eraPreset?: EraPresetId; npcOverrides?: Record<string, NpcVariant>; regionOverrides?: Record<string, NpcVariant> }
  | { action: "setRegionOverride"; regionId: number; variant: NpcVariant }
  | { action: "clearRegionOverride"; regionId: number }
  | { action: "toggleFavorite"; npcId: number }
  | { action: "addRecentDepMap"; debugname: string }
  | { action: "bulkSetNpcOverride"; npcIds: number[]; variant: NpcVariant }
  | { action: "bulkClearNpcOverride"; npcIds: number[] };

export type RecentDepMapsResponse = {
  recent: string[];
};

// ---------- Deps (/api/deps) ----------
export type DepEdge = { kind: string; id: number | string; via?: string; missing?: boolean };

export type DepNode = {
  kind: string;
  id: number | string;
  name: string | null;
  source: string;
  transformedFrom: number | string | null;
  cycle?: boolean;
  missing?: boolean;
  deps: DepEdge[];
};

export type DepsMap = {
  version?: number;
  root: { kind: string; id: number | string; name: string | null };
  nodes: Record<string, DepNode>;
  cycles: { path: string[]; reentry: string }[];
  missing: { kind: string; id: number | string }[];
  _demo?: boolean;
};

export type DepsListResponse = {
  available: string[];
};
