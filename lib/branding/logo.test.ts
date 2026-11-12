// lib/branding/logo.test.ts
import { describe, expect, test, vi } from "vitest";
import { uploadLogo, InvalidLogoFileError, MAX_LOGO_BYTES } from "./logo";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "logo", { type });
}

describe("uploadLogo", () => {
  test("rejects a disallowed MIME type before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/gif", 100), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("rejects a file over MAX_LOGO_BYTES before calling the uploader", async () => {
    const put = vi.fn();
    await expect(uploadLogo("studio-1", fakeFile("image/png", MAX_LOGO_BYTES + 1), put))
      .rejects.toThrow(InvalidLogoFileError);
    expect(put).not.toHaveBeenCalled();
  });

  test("uploads a valid file and returns the stored URL", async () => {
    const put = vi.fn().mockResolvedValue({ url: "https://blob.example/studio-1-logo.png" });
    const url = await uploadLogo("studio-1", fakeFile("image/png", 1000), put);
    expect(url).toBe("https://blob.example/studio-1-logo.png");
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining("studio-1"),
      expect.anything(),
      expect.objectContaining({ access: "public" })
    );
  });
});
