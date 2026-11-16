// components/student-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { StudentForm } from "./student-form";

// Same reason as components/branding-settings-form.test.tsx: this
// component calls next/navigation's useRouter() to refresh the parent
// Server Component after a save, which throws outside a real app-router
// tree unless mocked.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
});

describe("StudentForm", () => {
  test("submits a new student to the Task 1 POST students route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "s1", displayName: "Alex Example" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(<StudentForm studioId="studio-1" />);

    fireEvent.change(getByLabelText(/name/i), { target: { value: "Alex Example" } });
    fireEvent.change(getByLabelText(/email/i), { target: { value: "alex@example.com" } });
    fireEvent.click(getByRole("button", { name: /add student/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/students",
        expect.objectContaining({ method: "POST" })
      );
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      displayName: "Alex Example",
      email: "alex@example.com",
    });
  });

  test("refreshes the router after a successful create, so the student list re-renders with fresh data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "s1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(<StudentForm studioId="studio-1" />);
    fireEvent.change(getByLabelText(/name/i), { target: { value: "Alex Example" } });
    fireEvent.click(getByRole("button", { name: /add student/i }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  test("shows an error message when the create request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole, findByText } = render(<StudentForm studioId="studio-1" />);
    fireEvent.change(getByLabelText(/name/i), { target: { value: "Alex Example" } });
    fireEvent.click(getByRole("button", { name: /add student/i }));

    await findByText("Forbidden");
  });

  test("edits an existing student via the Task 1 PATCH route when a student is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "s1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(
      <StudentForm
        studioId="studio-1"
        student={{ id: "s1", displayName: "Alex Example", email: null, phone: null }}
      />
    );

    expect((getByLabelText(/name/i) as HTMLInputElement).value).toBe("Alex Example");

    fireEvent.change(getByLabelText(/name/i), { target: { value: "Alex Updated" } });
    fireEvent.click(getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/students/s1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  test("sends an explicit null when an existing email is blanked out on edit, so it's actually cleared", async () => {
    // updateStudentSchema/the PATCH route only clear a field on an
    // explicit `null` — omitting the key (like the create path does for
    // a blank optional field) leaves the stored value untouched.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "s1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(
      <StudentForm
        studioId="studio-1"
        student={{ id: "s1", displayName: "Alex Example", email: "alex@example.com", phone: "555-0100" }}
      />
    );

    fireEvent.change(getByLabelText(/email/i), { target: { value: "" } });
    fireEvent.click(getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/students/s1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      displayName: "Alex Example",
      email: null,
      phone: "555-0100",
    });
  });
});
