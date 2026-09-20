"use client";
import { AUDIENCE_SECTIONS, sectionChannelsFor, type AdminSnapshotData } from "@orchestra/contracts";
import { MapPanel } from "./MapPanel";

export function AssignPanel({ snapshot }: { snapshot: AdminSnapshotData }) {
  const members = snapshot.audienceMap.sections ?? [];
  const routes = sectionChannelsFor(snapshot.show);
  const automatic = members.filter(member => member.source === "automatic").length;
  const manual = members.length - automatic;
  const unassigned = snapshot.devices.length - members.length;
  return <section>
    <div className="stage-heading"><span className="stage-number">02</span><div><p className="eyebrow">AUTOMATIC AUDIENCE GROUPS</p><h2>Audience sections</h2></div><span className="stage-badge">{automatic ? "Assigned automatically" : "Waiting for calibration"}</span></div>
    <p className="muted">Recognized phones are ordered from audience-left to audience-right and divided into four equal groups. The split follows the number of phones, so section widths can differ.</p>
    <div className="audience-section-grid">{AUDIENCE_SECTIONS.map(section => {
      const group = members.filter(member => member.section === section.id);
      const channel = snapshot.show.channels.find(item => item.channelId === routes[section.id]);
      const tracks = snapshot.show.clips.filter(clip => clip.channelId === channel?.channelId)
        .map(clip => snapshot.show.tracks.find(track => track.trackId === clip.trackId)?.label).filter(Boolean);
      return <div className="audience-section-card" key={section.id} style={{ borderTopColor: section.color }}>
        <h3>{section.label}</h3><strong>{group.length} phones</strong><p>{channel?.label ?? "Silent"}</p>
        <small>{tracks.join(" · ") || (channel ? "No audio loaded in this lane" : "No music assigned")}</small>
        {group.some(member => member.source === "manual") && <p className="muted">{group.filter(member => member.source === "manual").length} chose this section</p>}
      </div>;
    })}</div>
    <p>{automatic} automatically placed · {manual} manual fallback · {unassigned} waiting for a position or section choice.</p>
    <p className="muted">Music follows the presets in <a href="#show-configuration">Prepare show and stems</a>. Committing a calibration map applies them automatically; there is nothing to select here.</p>
    <MapPanel map={snapshot.audienceMap} assignments={snapshot.assignments} channels={snapshot.show.channels} drawable={false} automaticSections />
  </section>;
}
