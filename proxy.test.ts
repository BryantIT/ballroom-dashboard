// proxy.test.ts
// @vitest-environment node
import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  test("redirects an unauthenticated request to a protected path to /login", () => {
    const request = new NextRequest("http://localhost/dashboard");
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  test("passes through an unauthenticated request to a public path", () => {
    const request = new NextRequest("http://localhost/login");
    const response = proxy(request);
    expect(response.status).toBe(200);
  });

  test("passes through a request to a protected path that carries a session cookie", () => {
    const request = new NextRequest("http://localhost/dashboard");
    request.cookies.set("authjs.session-token", "fake-token-value");
    const response = proxy(request);
    expect(response.status).toBe(200);
  });
});
