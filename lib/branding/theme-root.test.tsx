// lib/branding/theme-root.test.tsx
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { ThemeRoot } from "./theme-root";

describe("ThemeRoot", () => {
  test("renders a data-theme-root wrapper with the preset's CSS inlined", () => {
    const { container } = render(
      <ThemeRoot preset="ocean" accentOverride={null}>
        <p>hello</p>
      </ThemeRoot>
    );
    expect(container.querySelector("[data-theme-root]")).not.toBeNull();
    expect(container.querySelector("style")?.textContent).toContain("--primary: #2c7a8c");
  });

  test("the root element actually consumes the overridden background/foreground variables", () => {
    const { container } = render(
      <ThemeRoot preset="ocean" accentOverride={null}>
        <p>hello</p>
      </ThemeRoot>
    );
    const root = container.querySelector("[data-theme-root]");
    expect(root?.className).toContain("bg-background");
    expect(root?.className).toContain("text-foreground");
  });

  test("passes forceMode through to buildThemeCss so the result is mode-locked", () => {
    const { container } = render(
      <ThemeRoot preset="ocean" accentOverride={null} forceMode="dark">
        <p>hello</p>
      </ThemeRoot>
    );
    const css = container.querySelector("style")?.textContent ?? "";
    // The dark preset's background should now also appear in the
    // light (no-.dark-ancestor) rule, not just under .dark.
    expect(css.match(/--background: #0e1f24/g)).toHaveLength(2);
  });
});
