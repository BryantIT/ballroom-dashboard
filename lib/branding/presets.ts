export const THEME_PRESET_KEYS = [
  "midnight",
  "blush",
  "noir",
  "garden",
  "sunset",
  "ocean",
] as const;

export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

export type ThemeTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
};

export const THEME_PRESETS: Record<
  ThemePresetKey,
  { light: ThemeTokens; dark: ThemeTokens }
> = {
  midnight: {
    light: {
      background: "#f7f5ef",
      foreground: "#1b2030",
      card: "#ffffff",
      cardForeground: "#1b2030",
      primary: "#c9a24b",
      primaryForeground: "#1b2030",
      muted: "#ece7da",
      mutedForeground: "#6b6552",
      border: "#ddd6c4",
    },
    dark: {
      background: "#12182b",
      foreground: "#e9e4d8",
      card: "#1a2238",
      cardForeground: "#e9e4d8",
      primary: "#c9a24b",
      primaryForeground: "#12182b",
      muted: "#202a44",
      mutedForeground: "#a9a38c",
      border: "#2a3454",
    },
  },
  blush: {
    light: {
      background: "#fff6f3",
      foreground: "#2e2a2b",
      card: "#ffffff",
      cardForeground: "#2e2a2b",
      primary: "#d98a9b",
      primaryForeground: "#2e2a2b",
      muted: "#f1d9d0",
      mutedForeground: "#7a5d61",
      border: "#ecd3c9",
    },
    dark: {
      background: "#241a1c",
      foreground: "#f6e9e4",
      card: "#2e2224",
      cardForeground: "#f6e9e4",
      primary: "#d98a9b",
      primaryForeground: "#241a1c",
      muted: "#3a2c2f",
      mutedForeground: "#c9a8ac",
      border: "#433437",
    },
  },
  noir: {
    light: {
      background: "#f5f5f5",
      foreground: "#111111",
      card: "#ffffff",
      cardForeground: "#111111",
      primary: "#c81e3a",
      primaryForeground: "#ffffff",
      muted: "#e6e6e6",
      mutedForeground: "#4d4d4d",
      border: "#d0d0d0",
    },
    dark: {
      background: "#111111",
      foreground: "#f2f2f2",
      card: "#1c1c1c",
      cardForeground: "#f2f2f2",
      primary: "#c81e3a",
      primaryForeground: "#ffffff",
      muted: "#2b2b2b",
      mutedForeground: "#b3b3b3",
      border: "#333333",
    },
  },
  garden: {
    light: {
      background: "#f6f3ea",
      foreground: "#2f3a2b",
      card: "#ffffff",
      cardForeground: "#2f3a2b",
      primary: "#7a9273",
      primaryForeground: "#ffffff",
      muted: "#e3ddc8",
      mutedForeground: "#5f6b55",
      border: "#d7cfae",
    },
    dark: {
      background: "#1c231a",
      foreground: "#e8e4d4",
      card: "#263121",
      cardForeground: "#e8e4d4",
      primary: "#8aa67f",
      primaryForeground: "#1c231a",
      muted: "#30402a",
      mutedForeground: "#a9b89d",
      border: "#3f4a3a",
    },
  },
  sunset: {
    light: {
      background: "#fdf1e6",
      foreground: "#4a2e22",
      card: "#ffffff",
      cardForeground: "#4a2e22",
      primary: "#d9703a",
      primaryForeground: "#ffffff",
      muted: "#f6d9b8",
      mutedForeground: "#8a5a3c",
      border: "#efc79a",
    },
    dark: {
      background: "#2a1a10",
      foreground: "#f6e3cc",
      card: "#352316",
      cardForeground: "#f6e3cc",
      primary: "#e08a53",
      primaryForeground: "#2a1a10",
      muted: "#45301f",
      mutedForeground: "#c9a479",
      border: "#533a25",
    },
  },
  ocean: {
    light: {
      background: "#eef5f6",
      foreground: "#163038",
      card: "#ffffff",
      cardForeground: "#163038",
      primary: "#2c7a8c",
      primaryForeground: "#ffffff",
      muted: "#cfe6ea",
      mutedForeground: "#4c7680",
      border: "#bcdce1",
    },
    dark: {
      background: "#0e1f24",
      foreground: "#d9eef1",
      card: "#15282e",
      cardForeground: "#d9eef1",
      primary: "#3f9bb0",
      primaryForeground: "#0e1f24",
      muted: "#1c3b43",
      mutedForeground: "#9fc3cb",
      border: "#24474f",
    },
  },
};

export function buildThemeCss(
  preset: ThemePresetKey,
  accentOverride?: string | null
): string {
  const base = THEME_PRESETS[preset];
  const light: ThemeTokens = { ...base.light };
  const dark: ThemeTokens = { ...base.dark };
  if (typeof accentOverride === "string") {
    light.primary = accentOverride;
    dark.primary = accentOverride;
  }

  return `[data-theme-root] { --background: ${light.background}; --foreground: ${light.foreground}; --card: ${light.card}; --card-foreground: ${light.cardForeground}; --primary: ${light.primary}; --primary-foreground: ${light.primaryForeground}; --muted: ${light.muted}; --muted-foreground: ${light.mutedForeground}; --border: ${light.border}; }
.dark [data-theme-root] { --background: ${dark.background}; --foreground: ${dark.foreground}; --card: ${dark.card}; --card-foreground: ${dark.cardForeground}; --primary: ${dark.primary}; --primary-foreground: ${dark.primaryForeground}; --muted: ${dark.muted}; --muted-foreground: ${dark.mutedForeground}; --border: ${dark.border}; }`;
}
