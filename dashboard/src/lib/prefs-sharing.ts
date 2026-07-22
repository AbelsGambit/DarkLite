/**
 * Shareable preference URL encoding/decoding.
 *
 * Encodes a player's preferences into a compact URL hash fragment that can
 * be shared + applied by another browser. Uses base64url encoding of a
 * minimal JSON shape.
 *
 * Format: `#prefs=<base64url-encoded-json>`
 * JSON shape: `{ e: eraPreset, n: { npcId: variant }, r: { regionId: variant } }`
 *
 * The keys are kept short to keep the URL compact.
 */

import type { EraPreset, NpcVariant, PlayerPreference } from "@/lib/player-preferences";

type ShareablePrefs = {
  e: EraPreset;
  n: Record<string, NpcVariant>;
  r: Record<string, NpcVariant>;
};

/**
 * Encode a player's preferences into a URL hash fragment.
 * Returns just the fragment (e.g. "#prefs=eyJlIjoi...") — caller appends to URL.
 */
export function encodePreferencesToHash(pref: PlayerPreference): string {
  const shareable: ShareablePrefs = {
    e: pref.eraPreset,
    n: pref.npcOverrides,
    r: pref.regionOverrides,
  };
  const json = JSON.stringify(shareable);
  // base64url encode (browser-safe, URL-safe)
  const base64 = typeof btoa !== "undefined"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, "utf-8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `#prefs=${base64url}`;
}

/**
 * Decode preferences from a URL hash fragment.
 * Returns null if the hash doesn't contain a valid prefs fragment.
 */
export function decodePreferencesFromHash(hash: string): {
  eraPreset: EraPreset;
  npcOverrides: Record<string, NpcVariant>;
  regionOverrides: Record<string, NpcVariant>;
} | null {
  const match = hash.match(/^#prefs=(.+)$/);
  if (!match) return null;
  const base64url = match[1];
  // base64url decode
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  try {
    const json = typeof atob !== "undefined"
      ? decodeURIComponent(escape(atob(padded)))
      : Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as ShareablePrefs;
    if (!parsed.e || typeof parsed.e !== "string") return null;
    return {
      eraPreset: parsed.e as EraPreset,
      npcOverrides: parsed.n ?? {},
      regionOverrides: parsed.r ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Copy a shareable URL (current origin + pathname + hash) to the clipboard.
 * Returns the URL that was copied (or throws).
 */
export async function copyShareableUrl(pref: PlayerPreference): Promise<string> {
  const hash = encodePreferencesToHash(pref);
  const url = `${window.location.origin}${window.location.pathname}${hash}`;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(url);
  } else {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  return url;
}
