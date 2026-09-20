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
    <div className="stage-heading"><span className="stage-number">02</span><h2>Sections</h2><span className="stage-badge">{automatic ? "Assigned" : "Awaiting calibration"}</span></div>
    <p className="muted">Four balanced groups, ordered left to right while facing the stage.</p>
    <div className="audience-section-grid audience-section-overview">{AUDIENCE_SECTIONS.map(section => {
      const group = members.filter(member => member.section === section.id);
      const channel = snapshot.show.channels.find(item => item.channelId === routes[section.id]);
      return <div className="audience-section-card" key={section.id}>
        <h3><span className="swatch" style={{ background: section.color }} aria-hidden="true" />{section.label}</h3><strong>{group.length} <small>phones</small></strong><p>{channel?.label ?? "Silent"}</p>
        {group.some(member => member.source === "manual") && <p className="muted">{group.filter(member => member.source === "manual").length} chose this section</p>}
      </div>;
    })}</div>
    <p className="muted">{automatic} placed · {manual} manual · {unassigned} unassigned. <a href="#show-configuration">Edit music presets</a>.</p>
    <MapPanel map={snapshot.audienceMap} assignments={snapshot.assignments} channels={snapshot.show.channels} drawable={false} automaticSections />
  </section>;
}
