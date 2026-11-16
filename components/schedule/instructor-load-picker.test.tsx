// components/schedule/instructor-load-picker.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { InstructorLoadPicker } from "./instructor-load-picker";

afterEach(cleanup);

const instructors = [
  { instructorUserId: "instr-a", name: "Instructor A", activeStudentCount: 12 },
  { instructorUserId: "instr-b", name: "Instructor B", activeStudentCount: 3 },
];

describe("InstructorLoadPicker", () => {
  test("shows each instructor's name alongside their current active-student count", () => {
    render(<InstructorLoadPicker instructors={instructors} value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/Instructor A/)).not.toBeNull();
    expect(screen.getByText(/12 active students/)).not.toBeNull();
    expect(screen.getByText(/Instructor B/)).not.toBeNull();
    expect(screen.getByText(/3 active students/)).not.toBeNull();
  });

  test("calls onChange with the picked instructor's id", () => {
    const onChange = vi.fn();
    render(<InstructorLoadPicker instructors={instructors} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Instructor B/ }));
    expect(onChange).toHaveBeenCalledWith("instr-b");
  });

  test("marks the instructor matching `value` as checked", () => {
    render(<InstructorLoadPicker instructors={instructors} value="instr-a" onChange={vi.fn()} />);
    expect((screen.getByRole("radio", { name: /Instructor A/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Instructor B/ }) as HTMLInputElement).checked).toBe(false);
  });
});
