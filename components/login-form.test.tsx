// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LoginForm } from "./login-form";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

// LoginForm calls next/navigation's useSearchParams(), which throws
// outside a real Next.js app-router tree — mock it so each test controls
// the current search params directly.
const { searchParamsMock } = vi.hoisted(() => ({ searchParamsMock: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
}));

describe("LoginForm", () => {
  test("submits email and password to signIn with the credentials provider", async () => {
    searchParamsMock.delete("error");
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

  test("shows no error message when there's no error search param", () => {
    searchParamsMock.delete("error");
    const { queryByText } = render(<LoginForm />);
    expect(queryByText(/invalid email or password/i)).toBeNull();
  });

  test("shows a plain error message when the error search param is present", () => {
    searchParamsMock.set("error", "CredentialsSignin");
    const { getByText } = render(<LoginForm />);
    expect(getByText(/invalid email or password/i)).toBeTruthy();
    searchParamsMock.delete("error");
  });
});
