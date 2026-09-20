import type { z } from "zod";
import type { AudienceSection, Location, SectionChannels, SectionMembership, Show } from "./models";

export type AudienceSectionId = z.infer<typeof AudienceSection>;
export type SectionMembershipData = z.infer<typeof SectionMembership>;
export const AUDIENCE_SECTIONS = [
  { id: "left", label: "Left", color: "#38bdf8" },
  { id: "center-left", label: "Center left", color: "#a78bfa" },
  { id: "center-right", label: "Center right", color: "#f472b6" },
  { id: "right", label: "Right", color: "#f59e0b" },
] as const;

/** Balanced counts, independent of physical width or camera column. No invented locations. */
export function splitAudience(locations: z.infer<typeof Location>[]) {
  const ordered = locations.filter(location => location.status === "localized")
    .sort((a, b) => a.x - b.x || a.y - b.y || a.deviceId - b.deviceId);
  let offset = 0;
  let startX = 0;
  return AUDIENCE_SECTIONS.map((section, index) => {
    const size = Math.floor(ordered.length / 4) + (index < ordered.length % 4 ? 1 : 0);
    const deviceIds = ordered.slice(offset, offset + size).map(location => location.deviceId);
    offset += size;
    const endX = ordered.length === 0 ? (index + 1) / 4
      : offset >= ordered.length ? 1 : (ordered[offset - 1].x + ordered[offset].x) / 2;
    const group = { ...section, deviceIds, startX, endX };
    startX = endX;
    return group;
  });
}

/** Existing shows keep their tracks/IDs; two sections may share the same musical lane. */
export function sectionChannelsFor(show: Pick<z.infer<typeof Show>, "channels" | "sectionChannels">): z.infer<typeof SectionChannels> {
  if (show.sectionChannels) return show.sectionChannels;
  const channel = (label: string) => show.channels.find(item => item.label.trim().toLowerCase() === label)?.channelId ?? null;
  return { left: channel("melody"), "center-left": channel("vocals"), "center-right": channel("vocals"), right: channel("percussion") };
}
