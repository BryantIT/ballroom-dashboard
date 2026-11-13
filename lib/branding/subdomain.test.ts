import { describe, expect, test } from "vitest";
import { extractSubdomainSlug } from "./subdomain";

describe("extractSubdomainSlug", () => {
  test("extracts the leftmost label from a studio subdomain", () => {
    expect(extractSubdomainSlug("gold-coast.ballroomdash.app")).toBe("gold-coast");
  });
  test("strips a port before parsing", () => {
    expect(extractSubdomainSlug("gold-coast.ballroomdash.app:3000")).toBe("gold-coast");
  });
  test("returns null for an apex domain (two labels, no subdomain)", () => {
    expect(extractSubdomainSlug("ballroomdash.app")).toBeNull();
  });
  test("returns null for localhost", () => {
    expect(extractSubdomainSlug("localhost:3000")).toBeNull();
  });
  test("returns null for a bare IP host", () => {
    expect(extractSubdomainSlug("127.0.0.1:3000")).toBeNull();
  });
  test("lowercases the extracted label", () => {
    expect(extractSubdomainSlug("Gold-Coast.ballroomdash.app")).toBe("gold-coast");
  });
});
