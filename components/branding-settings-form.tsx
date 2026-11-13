"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { THEME_PRESET_KEYS, THEME_PRESETS, buildThemeCss, type ThemePresetKey } from "@/lib/branding/presets";
import type { PublicBranding } from "@/lib/branding/public-branding";

// Display names for the six presets. Colocated here (rather than
// presets.ts) since this is the only place they're used — presets.ts
// itself only knows the preset keys and color tokens, not copy.
export const PRESET_DISPLAY_NAMES: Record<ThemePresetKey, string> = {
  midnight: "Midnight Ballroom",
  blush: "Blush Studio",
  noir: "Classic Noir",
  garden: "Garden Waltz",
  sunset: "Sunset Tango",
  ocean: "Ocean Foxtrot",
};

type ColorMode = PublicBranding["colorMode"];

type BrandingSettingsFormProps = {
  studioId: string;
  initial: Pick<
    PublicBranding,
    "themePreset" | "accentColorOverride" | "colorMode" | "slug" | "logoUrl"
  >;
};

export function BrandingSettingsForm({ studioId, initial }: BrandingSettingsFormProps) {
  const router = useRouter();
  const [themePreset, setThemePreset] = useState<ThemePresetKey>(initial.themePreset);
  const [accentColorOverride, setAccentColorOverride] = useState(
    initial.accentColorOverride ?? ""
  );
  const [colorMode, setColorMode] = useState<ColorMode>(initial.colorMode);
  const [slug, setSlug] = useState(initial.slug);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const trimmedAccentPreview = accentColorOverride.trim();
  const isValidHexPreview = /^#[0-9a-fA-F]{6}$/.test(trimmedAccentPreview);
  // Renders into the dashboard layout's own [data-theme-root] ancestor —
  // CSS selectors match elements regardless of where the <style> tag
  // lives in the tree, and this tag is later in document order than the
  // layout's, so it wins the cascade for the same custom properties
  // without needing !important. This is a live, unsaved preview only:
  // nothing here is persisted until Save is pressed, and navigating away
  // without saving leaves the stored branding untouched.
  const previewCss = buildThemeCss(themePreset, isValidHexPreview ? trimmedAccentPreview : null);

  async function readErrorMessage(response: Response, fallback: string): Promise<string> {
    const body = await response.json().catch(() => null);
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
    return fallback;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const trimmedAccent = accentColorOverride.trim();
      const response = await fetch(`/api/v1/studios/${studioId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themePreset,
          accentColorOverride: trimmedAccent === "" ? null : trimmedAccent,
          colorMode,
          slug,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save branding"));
      }

      if (logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
        const logoResponse = await fetch(`/api/v1/studios/${studioId}/branding/logo`, {
          method: "POST",
          body: formData,
        });
        if (!logoResponse.ok) {
          throw new Error(await readErrorMessage(logoResponse, "Failed to upload logo"));
        }
      }

      setStatus("saved");
      // The server-rendered nav/ThemeRoot live in the parent layout, not
      // this form — refresh so they re-render with the branding we just
      // saved, without a full page reload.
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <>
      <style data-branding-preview>{previewCss}</style>
      <form onSubmit={handleSubmit} className="flex w-full max-w-lg flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Theme preset</legend>
        <div className="flex flex-col gap-2">
          {THEME_PRESET_KEYS.map((preset) => (
            <div key={preset} className="flex items-center gap-2">
              <input
                type="radio"
                id={`theme-preset-${preset}`}
                name="themePreset"
                value={preset}
                checked={themePreset === preset}
                onChange={() => setThemePreset(preset)}
                className="h-4 w-4 accent-primary"
              />
              <Label htmlFor={`theme-preset-${preset}`}>{PRESET_DISPLAY_NAMES[preset]}</Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accentColorOverride">Accent color override (optional)</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick accent color"
            value={isValidHexPreview ? trimmedAccentPreview : THEME_PRESETS[themePreset].light.primary}
            onChange={(event) => setAccentColorOverride(event.target.value)}
            className="h-10 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent p-1"
          />
          <Input
            id="accentColorOverride"
            placeholder="#c9a24b"
            value={accentColorOverride}
            onChange={(event) => setAccentColorOverride(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="colorMode">Color mode</Label>
        <select
          id="colorMode"
          value={colorMode}
          onChange={(event) => setColorMode(event.target.value as ColorMode)}
          className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" value={slug} onChange={(event) => setSlug(event.target.value)} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="logo">Logo</Label>
        <input
          id="logo"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Recommended: a square logo, 512x512px, SVG or PNG with a transparent
          background, under 2MB. A logo that doesn&apos;t match this will be
          resized to fit.
        </p>
      </div>

      {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status === "saved" ? <p className="text-sm text-muted-foreground">Saved.</p> : null}

      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving..." : "Save"}
      </Button>
      </form>
    </>
  );
}
