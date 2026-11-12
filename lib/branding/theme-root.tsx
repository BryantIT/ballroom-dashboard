// lib/branding/theme-root.tsx
import type { ReactNode } from "react";
import { buildThemeCss, type ThemePresetKey } from "./presets";

export function ThemeRoot({
  preset,
  accentOverride,
  forceMode,
  children,
}: {
  preset: ThemePresetKey;
  accentOverride: string | null;
  // Mode-locks the rendered theme to "light" or "dark" regardless of the
  // .dark class on <html> (see buildThemeCss). Omit to keep today's
  // dual light/dark behavior driven by next-themes' system-preference
  // detection — this is the only mode the authenticated dashboard uses.
  forceMode?: "light" | "dark";
  children: ReactNode;
}) {
  return (
    <div data-theme-root className="flex flex-1 flex-col bg-background text-foreground">
      <style
        dangerouslySetInnerHTML={{ __html: buildThemeCss(preset, accentOverride, forceMode) }}
      />
      {children}
    </div>
  );
}
