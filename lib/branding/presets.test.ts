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
});
