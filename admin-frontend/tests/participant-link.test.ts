import { expect, test } from "bun:test";
import { detectorTestLink, participantLink, participantLinkKey } from "../src/lib/participant-link";

test("pasting a tunnel origin creates a join URL for the current session", () => {
  expect(participantLink(" https://device-test.trycloudflare.com ", "my concert")).toBe("https://device-test.trycloudflare.com/?session=my+concert");
});
test("an old session in a saved URL cannot send devices to the wrong concert", () => {
  expect(participantLink("https://audience.example.com/?session=old#test", "new")).toBe("https://audience.example.com/?session=new");
  expect(participantLinkKey("new")).not.toBe(participantLinkKey("old"));
});
test("detector-test QR uses the exact participant tunnel origin without a session", () => {
  expect(detectorTestLink("https://device-test.trycloudflare.com/?session=old#test"))
    .toBe("https://device-test.trycloudflare.com/detector-test");
});
test("unsafe schemes and credential-bearing links are not rendered as audience links", () => {
  for (const value of ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.com", "not a URL"]) {
    expect(() => participantLink(value, "demo")).toThrow();
  }
});
