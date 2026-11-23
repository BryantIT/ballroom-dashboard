// components/student-list.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { StudentList } from "./student-list";

// StudentList renders StudentForm when canCreateStudent is true, which
// itself calls next/navigation's useRouter() — see
// components/student-form.test.tsx for why this must be mocked.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const students = [
  {
    id: "s1",
    studioId: "studio-1",
    displayName: "Alex Example",
    email: "alex@example.com",
    phone: null,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "s2",
    studioId: "studio-1",
    displayName: "Blair Smith",
    email: null,
    phone: null,
    createdAt: new Date("2026-01-02"),
  },
];

describe("StudentList", () => {
  test("renders the fetched students", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={false} />);
    expect(screen.getByText("Alex Example")).not.toBeNull();
    expect(screen.getByText("Blair Smith")).not.toBeNull();
  });

  test("filters the list client-side by display name as the viewer types", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={false} />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "blair" } });
    expect(screen.queryByText("Alex Example")).toBeNull();
    expect(screen.getByText("Blair Smith")).not.toBeNull();
  });

  test("search is case-insensitive and matches partial names", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={false} />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "EX" } });
    expect(screen.getByText("Alex Example")).not.toBeNull();
    expect(screen.queryByText("Blair Smith")).toBeNull();
  });

  test("links each student to their detail page", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={false} />);
    const link = screen.getByRole("link", { name: /alex example/i });
    expect(link.getAttribute("href")).toBe("/dashboard/students/s1");
  });

  test("shows the add-student form when the viewer can create students", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={true} />);
    expect(screen.getByRole("button", { name: /add student/i })).not.toBeNull();
  });

  test("hides the add-student form when the viewer cannot create students", () => {
    render(<StudentList studioId="studio-1" students={students} canCreateStudent={false} />);
    expect(screen.queryByRole("button", { name: /add student/i })).toBeNull();
  });
});
