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
});
