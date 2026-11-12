// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LoginForm } from "./login-form";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

describe("LoginForm", () => {
  test("submits email and password to signIn with the credentials provider", async () => {
    const { signIn } = await import("next-auth/react");
    const { getByLabelText, getByRole } = render(<LoginForm />);
    fireEvent.change(getByLabelText(/email/i), {
      target: { value: "a@example.com" },
    });
    fireEvent.change(getByLabelText(/password/i), {
      target: { value: "secret" },
    });
    fireEvent.click(getByRole("button", { name: /sign in/i }));
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "a@example.com",
        password: "secret",
        redirectTo: "/dashboard",
      })
    );
  });
});
