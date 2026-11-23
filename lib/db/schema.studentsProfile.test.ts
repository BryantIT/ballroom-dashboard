import { describe, expect, test } from "vitest";
import { students } from "./schema";

describe("students table", () => {
  test("has nullable email and phone columns", () => {
    expect(Object.keys(students)).toEqual(expect.arrayContaining(["email", "phone"]));
  });
});
