import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "../app/page";

test("home page renders the Ballroom Dash heading and a theme toggle", () => {
  render(<Page />);
  expect(
    screen.getByRole("heading", { level: 1, name: "Ballroom Dash" })
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Toggle theme" })).toBeDefined();
});
