"""Pilot-relative color evidence and bounded temporal phase estimation."""

from dataclasses import dataclass

import numpy as np

from .protocol import HEADER, PACKET_SYMBOLS, SYMBOL_MS, decode_packet


@dataclass
class SampledPacket:
    phase_ms: float
    symbols: list[int | None]
    counts: list[int]
    pilots: list[list[float]]


def prepare_samples(track):
    times = np.array([sample.pts_ms for sample in track.samples], dtype=np.float64)
    colors = np.array([sample.rgb for sample in track.samples], dtype=np.float64)
    colors /= np.maximum(colors.sum(axis=1, keepdims=True), 1)
    return times, colors


def sample_packet(track, phase_ms, prepared=None):
    times, colors = prepared if prepared is not None else prepare_samples(track)
    relative = (times - phase_ms) / SYMBOL_MS
    slots = np.floor(relative).astype(np.int32)
    interior = ((relative - slots >= 0.25) & (relative - slots <= 0.75) &
                (slots >= 0) & (slots < PACKET_SYMBOLS))
    pilots = []
    for first_slot in (2, 4):
        selected = interior & ((slots == first_slot) | (slots == first_slot + 1))
        if selected.sum() < 2:
            return None
        pilots.append(np.median(colors[selected], axis=0))
    separation = float(np.linalg.norm(pilots[1] - pilots[0]))
    if separation < 0.18:
        return None
    d0 = np.linalg.norm(colors - pilots[0], axis=1)
    d1 = np.linalg.norm(colors - pilots[1], axis=1)
    credible = (np.minimum(d0, d1) <= separation * 0.45) & (
        np.abs(d0 - d1) >= separation * 0.2
    )
    counts = np.bincount(slots[interior], minlength=PACKET_SYMBOLS)
    zeros = np.bincount(slots[interior & credible & (d0 < d1)], minlength=PACKET_SYMBOLS)
    ones = np.bincount(slots[interior & credible & (d1 < d0)], minlength=PACKET_SYMBOLS)
    symbols = [
        (int(one > zero) if count >= 2 and max(zero, one) / count >= 0.8 else None)
        for count, zero, one in zip(counts, zeros, ones)
    ]
    # Guards remain neutral. None in a data slot is an erasure, never zero.
    symbols[:2] = symbols[53:] = [None, None]
    return SampledPacket(phase_ms, symbols, counts.tolist(), [p.tolist() for p in pilots])


def find_phase(track):
    if len(track.samples) < 40:
        return None
    prepared = prepare_samples(track)
    times = prepared[0]
    cadence = float(np.median(np.diff(times)))
    # Leading dark guards break tracks before the first two color-zero pilots.
    estimate = times[0] - 2 * SYMBOL_MS - cadence / 2
    candidates = []
    for offset in range(-100, 101, 10):
        phase = estimate + offset
        if phase < 0:
            continue
        sampled = sample_packet(track, phase, prepared)
        if sampled and tuple(sampled.symbols[2:13]) == HEADER:
            candidates.append(phase)
    if not candidates:
        return None
    # Fit on pilots/preamble only. Never search a phase to fit the requested tag/ID.
    return sample_packet(track, float(np.median(candidates)), prepared)


def decode_tracks(scan, manifest, camera_id):
    fitted = {track.track_id: find_phase(track) for track in scan.tracks}
    phases = [packet.phase_ms for packet in fitted.values() if packet is not None]
    phase = None
    messages = []
    if phases:
        center = max(phases, key=lambda value: sum(abs(other-value) <= 60 for other in phases))
        cluster = [value for value in phases if abs(value-center) <= 60]
        other = [value for value in phases if abs(value-center) > 150]
        if len(other) >= max(2, len(cluster) / 2):
            messages.append("Multiple incompatible packet phases; re-record one calibration run")
        else:
            phase = float(np.median(cluster))
    else:
        messages.append("No complete pilot/preamble track; check visibility, colors or capture start")
    observations, details = [], []
    participants = set(manifest["participantIds"])
    for track in scan.tracks:
        if len(track.samples) < 4:
            continue
        sampled = fitted[track.track_id]
        reason = "pilot/preamble not resolved"
        decoded = None
        if sampled is not None and phase is not None:
            if abs(sampled.phase_ms - phase) <= 75:
                decoded = decode_packet(sampled.symbols, manifest["runTag"], participants)
                reason = decoded.reason
            else:
                reason = "track phase disagrees with camera phase"
        elif sampled is not None:
            reason = "camera packet phase is ambiguous"
        centers = np.array([(s.x, s.y) for s in track.samples])
        center = np.median(centers, axis=0)
        status = decoded.status if decoded else "rejected"
        reasons = sorted(track.reasons) + [reason]
        if track.reasons and decoded and decoded.device_id is not None:
            status = "ambiguous"
        elif track.reasons:
            status = "rejected"
        observations.append({
            "cameraId": camera_id, "trackId": track.track_id,
            "deviceId": decoded.device_id if decoded else None, "status": status,
            "centerPx": {"x": float(center[0]), "y": float(center[1])},
            "firstPtsMs": track.samples[0].pts_ms, "lastPtsMs": track.samples[-1].pts_ms,
            "decodeScore": decoded.score if decoded else 0.0,
            "correctedBits": decoded.corrected_bits if decoded else 0,
            "erasedBits": decoded.erased_bits if decoded else 32, "reasons": reasons,
        })
        details.append({
            "trackId": track.track_id, "phasePtsMs": sampled.phase_ms if sampled else None,
            "symbols": sampled.symbols if sampled else None,
            "interiorSampleCounts": sampled.counts if sampled else None,
            "normalizedPilots": sampled.pilots if sampled else None,
            "trajectory": [[s.pts_ms, s.x, s.y] for s in track.samples],
            "reasons": reasons,
        })
    return observations, details, phase, messages
