"""Conservative decoding of the frozen extended-Hamming OTC v1 packet."""

import itertools
import json
from collections.abc import Sequence, Set
from dataclasses import dataclass
from functools import lru_cache

from .validation import ROOT

SYMBOL_MS = 200
PACKET_SYMBOLS = 55
HEADER = (0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0)  # Slots 2..12, no run-tag fitting.


@dataclass(frozen=True)
class WordDecode:
    device_id: int | None
    corrected_bits: int
    erased_bits: int
    reason: str


@dataclass(frozen=True)
class PacketDecode:
    device_id: int | None
    status: str
    corrected_bits: int
    erased_bits: int
    score: float
    reason: str


@lru_cache(maxsize=1)
def _codebook() -> dict[int, int]:
    data = json.loads((ROOT / "packages/contracts/generated/otc-codebook.json").read_text())
    words = data["codewords"]
    if data["version"] != "hamming16-11-v1" or len(words) != 2048:
        raise ValueError("Unsupported frozen codebook")
    mapping = {int(word, 2): device_id for device_id, word in enumerate(words)}
    if len(mapping) != 2048 or any(len(word) != 16 for word in words):
        raise ValueError("Invalid frozen codebook")
    return mapping


def _correct(word: int) -> int | None:
    # Positions are transmitted MSB first; position 16 is overall even parity.
    syndrome = 0
    for position in range(1, 16):
        if word & (1 << (16 - position)):
            syndrome ^= position
    if word.bit_count() % 2:
        return word ^ (1 << (16 - (syndrome or 16)))
    return None if syndrome else word


def _validate_symbols(symbols: Sequence[int | None], count: int) -> None:
    if len(symbols) != count or any(
        bit is not None and (type(bit) is not int or bit not in (0, 1)) for bit in symbols
    ):
        raise ValueError(f"Expected {count} symbols containing only 0, 1 or None")


def decode_word(symbols: Sequence[int | None]) -> WordDecode:
    """Accept a unique full-codebook candidate only when 2*errors+erasures < 4.

    SECDED cannot guarantee rejection of three or more corrupt bits. Independent
    repeat evidence and tracking rejection remain necessary at the packet layer.
    """
    _validate_symbols(symbols, 16)
    erased = [15 - i for i, bit in enumerate(symbols) if bit is None]
    if len(erased) >= 4:
        return WordDecode(None, 0, len(erased), "erasure bound exceeded")
    word = sum((bit or 0) << (15 - i) for i, bit in enumerate(symbols))
    known_mask = 0xFFFF ^ sum(1 << bit for bit in erased)
    candidates = {}
    for fill in itertools.product((0, 1), repeat=len(erased)):
        complete = word | sum(value << bit for value, bit in zip(fill, erased))
        corrected = _correct(complete)
        if corrected is None or corrected not in _codebook():
            continue
        errors = ((corrected ^ word) & known_mask).bit_count()
        if 2 * errors + len(erased) < 4:
            candidates[corrected] = errors
    if len(candidates) != 1:
        return WordDecode(None, 0, len(erased), "no unique bounded codeword")
    corrected, errors = next(iter(candidates.items()))
    return WordDecode(_codebook()[corrected], errors, len(erased), "bounded codeword")


def decode_packet(
    symbols: Sequence[int | None], run_tag: int, participant_ids: Set[int]
) -> PacketDecode:
    """Require exact header/tag, a bounded member ID, and no conflicting repeat."""
    _validate_symbols(symbols, PACKET_SYMBOLS)
    if type(run_tag) is not int or not 0 <= run_tag <= 255:
        raise ValueError("run_tag must be 0..255")
    if any(type(value) is not int or not 0 <= value <= 2047 for value in participant_ids):
        raise ValueError("participant IDs must be integers 0..2047")
    erased = sum(bit is None for bit in symbols[21:53])

    def reject(reason):
        return PacketDecode(None, "rejected", 0, erased, 0.0, reason)

    if tuple(symbols[2:13]) != HEADER:
        return reject("incomplete or incorrect pilot/preamble")
    if any(bit is None for bit in symbols[13:21]):
        return reject("uncertain run tag")
    if int("".join(map(str, symbols[13:21])), 2) != run_tag:
        return reject("wrong run tag")
    first = decode_word(symbols[21:37])
    second = decode_word([None if bit is None else 1 - bit for bit in symbols[37:53]])
    ids = {item.device_id for item in (first, second) if item.device_id is not None}
    if not ids:
        return reject("both identity passes rejected")
    if not ids <= participant_ids:
        return reject("ID outside participant set")
    errors = first.corrected_bits + second.corrected_bits
    # This is an evidence ranking score, not a probability.
    score = max(0.0, 1.0 - errors * 0.06 - erased * 0.025)
    if len(ids) > 1:
        return PacketDecode(None, "ambiguous", errors, erased, score, "identity passes conflict")
    device_id = next(iter(ids))
    if first.device_id is None or second.device_id is None:
        return PacketDecode(device_id, "accepted", errors, erased, score,
                            "single bounded pass; repeat unreadable")
    return PacketDecode(device_id, "accepted", errors, erased, score, "agreeing bounded passes")
