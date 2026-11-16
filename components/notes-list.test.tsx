// components/notes-list.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, waitFor, screen, cleanup } from "@testing-library/react";
import { NotesList } from "./notes-list";

// This component calls next/navigation's useRouter() to refresh the
// parent Server Component after adding a note, so canReadNote/
// canWriteNote are re-resolved server-side rather than guessed
// client-side. See components/branding-settings-form.test.tsx for the
// same mocking note.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
});

const notes = [
  {
    id: "n1",
    studioId: "studio-1",
    studentId: "student-1",
    authorUserId: "user-1",
    body: "Loves foxtrot.",
    restricted: false,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "n2",
    studioId: "studio-1",
    studentId: "student-1",
    authorUserId: "user-1",
    body: "Billing dispute details.",
    restricted: true,
    createdAt: new Date("2026-01-02"),
  },
];

describe("NotesList", () => {
  test("shows only the notes the current viewer is allowed to see", () => {
    // The server has already filtered this list with canReadNote — the
    // component just renders what it's given.
    render(
      <NotesList studioId="studio-1" studentId="student-1" notes={[notes[0]]} canWriteNote={false} />
    );
    expect(screen.getByText("Loves foxtrot.")).not.toBeNull();
    expect(screen.queryByText("Billing dispute details.")).toBeNull();
  });

  test("shows an add-note control when the viewer can write notes", () => {
    render(<NotesList studioId="studio-1" studentId="student-1" notes={[]} canWriteNote={true} />);
    expect(screen.getByRole("button", { name: /add note/i })).not.toBeNull();
  });

  test("hides the add-note control when canWriteNote is false for the viewer", () => {
    render(<NotesList studioId="studio-1" studentId="student-1" notes={notes} canWriteNote={false} />);
    expect(screen.queryByRole("button", { name: /add note/i })).toBeNull();
    expect(screen.queryByLabelText(/add a note/i)).toBeNull();
  });

  test("submits a new note to the Task 3 POST notes route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "n3" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotesList studioId="studio-1" studentId="student-1" notes={[]} canWriteNote={true} />);
    fireEvent.change(screen.getByLabelText(/add a note/i), { target: { value: "New note body" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/students/student-1/notes",
        expect.objectContaining({ method: "POST" })
      );
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      body: "New note body",
      restricted: false,
    });
  });

  test("refreshes the router after a successful note submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "n3" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotesList studioId="studio-1" studentId="student-1" notes={[]} canWriteNote={true} />);
    fireEvent.change(screen.getByLabelText(/add a note/i), { target: { value: "New note body" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
