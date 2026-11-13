import { getTableColumns } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { appointmentAttendees, appointmentSeries, appointments } from "./schema";

describe("appointmentSeries table", () => {
  test("has the expected column set", () => {
    expect(Object.keys(getTableColumns(appointmentSeries)).sort()).toEqual(
      [
        "createdAt",
        "dayOfWeek",
        "endTime",
        "id",
        "instructorUserId",
        "locationId",
        "roomId",
        "seriesEndDate",
        "seriesStartDate",
        "startTime",
        "studioId",
      ].sort()
    );
  });
});

describe("appointments table", () => {
  test("has the expected column set", () => {
    expect(Object.keys(getTableColumns(appointments)).sort()).toEqual(
      [
        "createdAt",
        "crossInstructorReasonCode",
        "crossInstructorReasonNote",
        "endAt",
        "id",
        "instructorUserId",
        "locationId",
        "roomId",
        "seriesId",
        "startAt",
        "status",
        "studioId",
      ].sort()
    );
  });
});

describe("appointmentAttendees table", () => {
  test("has the expected column set", () => {
    expect(Object.keys(getTableColumns(appointmentAttendees)).sort()).toEqual(
      ["appointmentId", "id", "studentId", "studioId"].sort()
    );
  });
});
