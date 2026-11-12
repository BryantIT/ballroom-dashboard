import { describe, expect, test } from "vitest";
import { THEME_PRESETS, buildThemeCss } from "./presets";

describe("THEME_PRESETS", () => {
  test("has exactly the six decided preset keys", () => {
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(
      ["blush", "garden", "midnight", "noir", "ocean", "sunset"].sort()
    );
  });
});

describe("buildThemeCss", () => {
  test("emits light and dark rules using the preset's own tokens", () => {
    const css = buildThemeCss("midnight");
    expect(css).toContain("[data-theme-root]");
    expect(css).toContain("--primary: #c9a24b");
    expect(css).toContain(".dark [data-theme-root]");
    expect(css).toContain("--background: #12182b");
  });
  test("an accent override replaces --primary in both light and dark rules", () => {
    const css = buildThemeCss("midnight", "#ff0000");
    expect(css.match(/--primary: #ff0000/g)).toHaveLength(2);
  });
  test("a null/absent override leaves the preset's own accent untouched", () => {
    const css = buildThemeCss("midnight", null);
    expect(css).toContain("--primary: #c9a24b");
  });

  test("forceMode: 'light' emits the light token set in both the light and .dark rules", () => {
    const css = buildThemeCss("ocean", null, "light");
    expect(css.match(/--background: #eef5f6/g)).toHaveLength(2);
    expect(css).not.toContain("#0e1f24");
  });

  test("forceMode: 'dark' emits the dark token set in both the light and .dark rules", () => {
    const css = buildThemeCss("ocean", null, "dark");
    expect(css.match(/--background: #0e1f24/g)).toHaveLength(2);
    expect(css).not.toContain("#eef5f6");
  });

  test("omitting forceMode keeps today's dual light/dark output", () => {
    const css = buildThemeCss("ocean");
    expect(css).toContain("--background: #eef5f6");
    expect(css).toContain("--background: #0e1f24");
  });
});
