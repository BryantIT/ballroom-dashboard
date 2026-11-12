// lib/branding/theme-root.tsx
import type { ReactNode } from "react";
import { buildThemeCss, type ThemePresetKey } from "./presets";

export function ThemeRoot({
  preset,
  accentOverride,
  children,
}: {
  preset: ThemePresetKey;
  accentOverride: string | null;
  children: ReactNode;
}) {
  return (
    <div data-theme-root>
      <style dangerouslySetInnerHTML={{ __html: buildThemeCss(preset, accentOverride) }} />
      {children}
    </div>
  );
}
