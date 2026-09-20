"""Pilot-relative color evidence and bounded temporal phase estimation."""

from dataclasses import dataclass

import numpy as np

from .protocol import HEADER, SYMBOL_MS, decode_packet, packet_layout, v2_header_supported

MIN_PHASE_SAMPLES = 40


@dataclass
class SampledPacket:
    phase_ms: float
    symbols: list[int | None]
    counts: list[int]
    pilots: list[list[float]]
    preamble_reference: bool = False


def prepare_samples(track):
    times = np.array([sample.pts_ms for sample in track.samples], dtype=np.float64)
    colors = np.array([sample.rgb for sample in track.samples], dtype=np.float64)
    colors /= np.maximum(colors.sum(axis=1, keepdims=True), 1)
    return times, colors


def zero_evidence(colors, zero_color):
    r, g, b = colors[..., 0], colors[..., 1], colors[..., 2]
    if zero_color == "#FF0000":
        return (r-b >= 0.025) & (r-g >= 0.025)
    if zero_color == "#FFB000":
        return (r-b >= 0.025) & (g-b >= 0.025)
    raise ValueError(f"Unsupported calibration zero color: {zero_color}")


def sample_packet(track, phase_ms, prepared=None, *, zero_color="#FFB000", packet_version="otc-v1"):
    layout = packet_layout(packet_version)
    times, colors = prepared if prepared is not None else prepare_samples(track)
    relative = (times - phase_ms) / layout.symbol_ms
    slots = np.floor(relative).astype(np.int32)
    interior = ((relative - slots >= 0.25) & (relative - slots <= 0.75) &
                (slots >= 0) & (slots < layout.symbols))
    pilots = []
    preamble_reference = False
    for first_slot in (2, 4):
        selected = interior & ((slots == first_slot) | (slots == first_slot + 1))
        if packet_version == "otc-v2":
            measured = np.median(colors[selected], axis=0) if selected.sum() >= 2 else None
            credible_pilot = measured is not None and (
                zero_evidence(measured, zero_color) if first_slot == 2 else measured[2]-measured[0] >= 0.05)
        else:
            credible_pilot = True
        if not credible_pilot:
            preamble_reference = True
            bit = 0 if first_slot == 2 else 1
            reference_slots = [slot for slot in range(6, 13) if HEADER[slot-2] == bit]
            selected = interior & np.isin(slots, reference_slots)
        if selected.sum() < 2:
            return None
        pilots.append(np.median(colors[selected], axis=0))
    # Learn exposure/white balance from the pilots, with the first-color check
    # selected by this recording's manifest (new red or legacy amber).
    zero, blue = pilots
    if not (zero_evidence(zero, zero_color) and blue[2] - blue[0] >= 0.05):
        return None
    separation = float(np.linalg.norm(pilots[1] - pilots[0]))
    if separation < 0.18:
        return None
    d0 = np.linalg.norm(colors - pilots[0], axis=1)
    d1 = np.linalg.norm(colors - pilots[1], axis=1)
    credible = (np.minimum(d0, d1) <= separation * 0.45) & (
        np.abs(d0 - d1) >= separation * 0.2
    )
    counts = np.bincount(slots[interior], minlength=layout.symbols)
    zeros = np.bincount(slots[interior & credible & (d0 < d1)], minlength=layout.symbols)
    ones = np.bincount(slots[interior & credible & (d1 < d0)], minlength=layout.symbols)
    symbols = [
        (int(one > zero) if count >= 2 and max(zero, one) / count >= 0.8 else None)
        for count, zero, one in zip(counts, zeros, ones)
    ]
    # Guards remain neutral. None in a data slot is an erasure, never zero.
    symbols[:2] = symbols[layout.body_end:] = [None, None]
    return SampledPacket(phase_ms, symbols, counts.tolist(), [p.tolist() for p in pilots], preamble_reference)


def find_phase(track, *, zero_color="#FFB000", packet_version="otc-v1"):
    if packet_version == "otc-v2":
        return find_phase_v2(track, zero_color=zero_color)
    if len(track.samples) < MIN_PHASE_SAMPLES:
        return None
    prepared = prepare_samples(track)
    times, colors = prepared
    cadence = float(np.median(np.diff(times)))
    # Leading dark guards break tracks before the first two color-zero pilots.
    zero = zero_evidence(colors, zero_color)
    starts = np.flatnonzero(zero & ~np.r_[False, zero[:-1]])
    # A status bar or background reflection can keep a candidate alive through
    # the dark guards. Its first sample is then not the first pilot. Try actual
    # first-color onsets as well, using only the header to choose the packet phase.
    estimates = [times[0]-2*SYMBOL_MS-cadence/2]
    estimates.extend(times[index]-2*SYMBOL_MS-cadence/2 for index in starts
                     if times[index]-times[0] > 100)
    for estimate in estimates:
        candidates = []
        if estimate + 13*SYMBOL_MS > times[-1] + 100:
            continue
        for offset in range(-100, 101, 10):
            phase = estimate + offset
            if phase < 0:
                continue
            header = (times >= phase) & (times < phase + 13*SYMBOL_MS)
            sampled = sample_packet(track, phase, (times[header], colors[header]), zero_color=zero_color)
            if sampled and tuple(sampled.symbols[2:13]) == HEADER:
                candidates.append(phase)
        if candidates:
            return sample_packet(track, float(np.median(candidates)), prepared, zero_color=zero_color)
    return None


def find_phase_v2(track, *, zero_color):
    if len(track.samples) < MIN_PHASE_SAMPLES:
        return None
    prepared = prepare_samples(track)
    times, colors = prepared
    cadence = float(np.median(np.diff(times)))
    symbol_ms = packet_layout("otc-v2").symbol_ms
    zero = zero_evidence(colors, zero_color)
    blue = colors[:, 2]-colors[:, 0] >= 0.05
    estimates = []
    for evidence, slots in ((zero, (2, 9)), (blue, (4, 6, 11))):
        starts = np.flatnonzero(evidence & ~np.r_[False, evidence[:-1]])
        estimates.extend(times[index]-slot*symbol_ms-cadence/2
                         for index in starts for slot in slots)
    # Work from the earliest plausible header. Packet starts may precede the
    # clip when recording begins after the dedicated pilots.
    estimates = sorted(set(round(value, 1) for value in estimates
                           if value >= -6*symbol_ms and value+13*symbol_ms <= times[-1]+100))
    candidates = []
    for estimate in estimates:
        if candidates and estimate > max(p for p, _ in candidates)+symbol_ms:
            break
        for offset in range(-120, 121, 10):
            phase = estimate+offset
            header = (times >= phase+2*symbol_ms) & (times < phase+13*symbol_ms)
            if header.sum() < 10:
                continue
            sampled = sample_packet(track, phase, (times[header], colors[header]),
                                    zero_color=zero_color, packet_version="otc-v2")
            if sampled and v2_header_supported(sampled.symbols):
                support = sum(bit is not None for bit in sampled.symbols[6:13])
                candidates.append((phase, support))
    if not candidates:
        return None
    best_support = max(support for _, support in candidates)
    phases = sorted({phase for phase, support in candidates if support == best_support})
    if (phases[-1]-phases[0] > symbol_ms or
            any(b-a > symbol_ms/4 for a, b in zip(phases, phases[1:]))):
        return None  # Header alone does not distinguish these timing hypotheses.
    return sample_packet(track, float(np.median(phases)), prepared,
                         zero_color=zero_color, packet_version="otc-v2")


def decode_tracks(scan, manifest, camera_id):
    version = manifest.get("packetVersion", "otc-v1")
    layout = packet_layout(version)
    zero_color = manifest["palette"]["zero"].upper()
    if zero_color not in ("#FF0000", "#FFB000") or manifest["palette"]["one"].upper() != "#0066FF":
        raise ValueError("Unsupported calibration palette; expected red/blue or legacy amber/blue")
    palette_label = "red/blue" if zero_color == "#FF0000" else "amber/blue"
    fitted = {track.track_id: find_phase(track, zero_color=zero_color, packet_version=version)
              for track in scan.tracks}
    phases = [packet.phase_ms for packet in fitted.values() if packet is not None]
    phase = None
    messages = []
    if phases:
        center = max(phases, key=lambda value: sum(abs(other-value) <= 60 for other in phases))
        cluster = [value for value in phases if abs(value-center) <= 60]
        other = [value for value in phases if abs(value-center) > 150]
        if version == "otc-v1" and len(other) >= max(2, len(cluster) / 2):
            messages.append("Multiple incompatible packet phases; re-record one calibration run")
        else:
            phase = float(np.median(cluster))
    else:
        messages.append("No complete pilot/preamble track; check visibility, colors or capture start")
    background = sum(packet is None for packet in fitted.values())
    if background:
        messages.append(f"Ignored {background} candidates without a complete {palette_label} preamble; "
                        "not device tracks")
    observations, details = [], []
    participants = set(manifest["participantIds"])
    for track in scan.tracks:
        if fitted[track.track_id] is None:
            continue
        sampled = fitted[track.track_id]
        reason = "pilot/preamble not resolved"
        decoded = None
        if sampled is not None and phase is not None:
            if version == "otc-v2" or abs(sampled.phase_ms - phase) <= 75:
                decoded = decode_packet(sampled.symbols, manifest["runTag"], participants,
                                        packet_version=version)
                reason = decoded.reason
            else:
                reason = "track phase disagrees with camera phase"
        elif sampled is not None:
            reason = "camera packet phase is ambiguous"
        packet_samples = [s for s in track.samples
                          if sampled.phase_ms + 2*layout.symbol_ms <= s.pts_ms < sampled.phase_ms + layout.body_end*layout.symbol_ms]
        centers = np.array([(s.x, s.y) for s in packet_samples])
        center = np.median(centers, axis=0)
        status = decoded.status if decoded else "rejected"
        reasons = sorted(track.reasons) + [reason]
        if sampled.preamble_reference:
            reasons.append("preamble color reference; pilot unavailable")
        if version == "otc-v2" and any(bit is None for bit in sampled.symbols[6:13]):
            reasons.append("partial preamble; erased symbols")
        # Valid codes survive size changes and transient pieces of their own
        # screen. Block actual crossing/merging phones, not generic track warnings.
        collision = any(sampled.phase_ms + 2*layout.symbol_ms <= pts < sampled.phase_ms + layout.body_end*layout.symbol_ms
                        and (separate or fitted.get(peer) is not None)
                        for pts, peer, separate in track.collisions)
        if collision and decoded and decoded.device_id is not None:
            status = "ambiguous"
            reasons.append("independent screen tracks collided during packet")
        observations.append({
            "cameraId": camera_id, "trackId": track.track_id,
            "deviceId": decoded.device_id if decoded else None, "status": status,
            "centerPx": {"x": float(center[0]), "y": float(center[1])},
            "firstPtsMs": packet_samples[0].pts_ms, "lastPtsMs": packet_samples[-1].pts_ms,
            "decodeScore": decoded.score if decoded else 0.0,
            "correctedBits": decoded.corrected_bits if decoded else 0,
            "erasedBits": decoded.erased_bits if decoded else 32, "reasons": reasons,
        })
        details.append({
            "trackId": track.track_id, "phasePtsMs": sampled.phase_ms if sampled else None,
            "symbols": sampled.symbols if sampled else None,
            "interiorSampleCounts": sampled.counts if sampled else None,
            "normalizedPilots": sampled.pilots if sampled else None,
            "trajectory": [[s.pts_ms, s.x, s.y] for s in packet_samples],
            "reasons": reasons,
        })
    return observations, details, phase, messages
