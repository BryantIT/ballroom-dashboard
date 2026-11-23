// components/room-settings.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RoomSettingsLocation = {
  id: string;
  name: string;
};

export type RoomSettingsRoom = {
  id: string;
  name: string;
  locationId: string;
};

type RoomSettingsProps = {
  studioId: string;
  locations: RoomSettingsLocation[];
  // Every room in the studio (a single direct query scoped to the
  // studio, same convention as InstructorLocationSettings' assignments
  // prop) — never one GET-equivalent round trip per location.
  rooms: RoomSettingsRoom[];
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

// Only supports CREATING a room — there is no edit/delete route
// (lib/locations/rooms.ts's interface), so this component never tries
// to reconcile or remove an existing room.
export function RoomSettings({ studioId, locations, rooms: initialRooms }: RoomSettingsProps) {
  const router = useRouter();
  // Tracked locally so a successful creation is reflected immediately in
  // this list, rather than waiting on router.refresh()'s round trip back
  // through the parent Server Component.
  const [rooms, setRooms] = useState(initialRooms);
  const [nameByLocation, setNameByLocation] = useState<Record<string, string>>({});
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [errorByLocation, setErrorByLocation] = useState<Record<string, string>>({});

  function roomsForLocation(locationId: string): RoomSettingsRoom[] {
    return rooms.filter((room) => room.locationId === locationId);
  }

  async function handleCreate(locationId: string) {
    const name = (nameByLocation[locationId] ?? "").trim();
    if (!name) {
      return;
    }

    setSavingLocationId(locationId);
    setErrorByLocation((current) => ({ ...current, [locationId]: "" }));

    try {
      const response = await fetch(`/api/v1/studios/${studioId}/locations/${locationId}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create room"));
      }

      const created = (await response.json()) as RoomSettingsRoom;
      setRooms((current) => [...current, created]);
      setNameByLocation((current) => ({ ...current, [locationId]: "" }));
      router.refresh();
    } catch (err) {
      setErrorByLocation((current) => ({
        ...current,
        [locationId]: err instanceof Error ? err.message : "Something went wrong",
      }));
    } finally {
      setSavingLocationId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {locations.map((location) => {
        const locationRooms = roomsForLocation(location.id);
        const inputId = `new-room-name-${location.id}`;

        return (
          <div key={location.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">{location.name}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {locationRooms.map((room) => (
                <li key={room.id}>{room.name}</li>
              ))}
              {locationRooms.length === 0 ? (
                <li className="text-muted-foreground">No rooms configured yet.</li>
              ) : null}
            </ul>

            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={inputId}>Add a room</Label>
                <Input
                  id={inputId}
                  value={nameByLocation[location.id] ?? ""}
                  onChange={(event) =>
                    setNameByLocation((current) => ({ ...current, [location.id]: event.target.value }))
                  }
                  placeholder="e.g. Ballroom A"
                />
              </div>
              <Button
                type="button"
                onClick={() => handleCreate(location.id)}
                disabled={!(nameByLocation[location.id] ?? "").trim() || savingLocationId === location.id}
              >
                {savingLocationId === location.id ? "Adding..." : "Add"}
              </Button>
            </div>

            {errorByLocation[location.id] ? (
              <p className="text-sm text-destructive">{errorByLocation[location.id]}</p>
            ) : null}
          </div>
        );
      })}

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No locations configured yet.</p>
      ) : null}
    </div>
  );
}
