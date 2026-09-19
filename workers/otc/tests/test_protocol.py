import itertools
import json

import pytest

from otc.protocol import decode_packet, decode_word
from otc.validation import ROOT


def independent_word(device_id):
    # Algebraic parity equations; independent of the shared encoder/decoder.
    data = [int(bit) for bit in f"{device_id:011b}"]
    positions = [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]
    word = [0] * 16
    for position, value in zip(positions, data):
        word[position - 1] = value
    for parity in (1, 2, 4, 8):
        word[parity - 1] = sum(v for p, v in zip(positions, data) if p & parity) % 2
    word[15] = sum(word[:15]) % 2
    return word


def packet(device_id=0, tag=37):
    word = independent_word(device_id)
    return ([None, None, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0]
            + [int(bit) for bit in f"{tag:08b}"] + word
            + [1 - bit for bit in word] + [None, None])


def test_all_ids_match_frozen_codebook_and_decode():
    codebook = json.loads((ROOT / "packages/contracts/generated/otc-codebook.json").read_text())
    for device_id, frozen in enumerate(codebook["codewords"]):
        word = independent_word(device_id)
        assert "".join(map(str, word)) == frozen
        result = decode_word(word)
        assert result.device_id == device_id
        assert result.corrected_bits == result.erased_bits == 0


def test_every_single_bit_error_is_corrected_for_every_id():
    for device_id in range(2048):
        word = independent_word(device_id)
        for bit in range(16):
            damaged = word.copy()
            damaged[bit] ^= 1
            result = decode_word(damaged)
            assert result.device_id == device_id, (device_id, bit)
            assert result.corrected_bits == 1


def test_every_double_bit_error_is_rejected_for_every_id():
    pairs = list(itertools.combinations(range(16), 2))
    for device_id in range(2048):
        word = independent_word(device_id)
        for a, b in pairs:
            damaged = word.copy()
            damaged[a] ^= 1
            damaged[b] ^= 1
            assert decode_word(damaged).device_id is None, (device_id, a, b)


@pytest.mark.parametrize("device_id", [0, 1, 1024, 2047])
def test_up_to_three_erasures_and_one_error_plus_one_erasure(device_id):
    word = independent_word(device_id)
    for count in (1, 2, 3):
        for missing in itertools.combinations(range(16), count):
            damaged = word.copy()
            for i in missing:
                damaged[i] = None
            result = decode_word(damaged)
            assert result.device_id == device_id
            assert result.erased_bits == count
    for erased in range(16):
        for flipped in range(16):
            if erased == flipped:
                continue
            damaged = word.copy()
            damaged[erased] = None
            damaged[flipped] ^= 1
            result = decode_word(damaged)
            assert result.device_id == device_id
            assert result.corrected_bits == result.erased_bits == 1


def test_four_erasures_and_error_plus_two_erasures_exceed_bound():
    word = independent_word(1024)
    for missing in itertools.combinations(range(16), 4):
        damaged = word.copy()
        for i in missing:
            damaged[i] = None
        assert decode_word(damaged).device_id is None
    for a, b, flipped in ((0, 1, 2), (2, 7, 15), (5, 9, 11)):
        damaged = word.copy()
        damaged[a] = damaged[b] = None
        damaged[flipped] ^= 1
        assert decode_word(damaged).device_id is None


@pytest.mark.parametrize("bad", [[0]*15, [0]*17, [0]*15+[2], [0]*15+[False]])
def test_invalid_word_shape_raises(bad):
    with pytest.raises(ValueError):
        decode_word(bad)


def test_all_golden_packets_and_boundary_ids():
    goldens = json.loads((ROOT / "packages/contracts/generated/otc-golden-packets.json").read_text())
    for item in goldens:
        result = decode_packet(item["symbols"], item["runTag"], set(range(2048)))
        assert result.status == "accepted"
        assert result.device_id == item["deviceId"]
    assert decode_packet(packet(0), 37, {0}).device_id == 0


def test_tag_header_and_membership_are_not_repaired():
    assert decode_packet(packet(5, 38), 37, {5}).reason == "wrong run tag"
    uncertain = packet(5)
    uncertain[13] = None
    assert decode_packet(uncertain, 37, {5}).status == "rejected"
    bad_header = packet(5)
    bad_header[9] ^= 1
    assert decode_packet(bad_header, 37, {5}).status == "rejected"
    assert decode_packet(packet(5), 37, {4, 6}).reason == "ID outside participant set"


def test_conflicting_passes_and_single_pass_salvage_are_never_accepted():
    conflict = packet(4)
    conflict[37:53] = packet(5)[37:53]
    assert decode_packet(conflict, 37, {4, 5}).status == "ambiguous"
    assert decode_packet(conflict, 37, {4, 5}).device_id is None
    one_pass = packet(4)
    one_pass[37:53] = [None] * 16
    result = decode_packet(one_pass, 37, {4})
    assert result.status == "ambiguous"
    assert result.device_id == 4  # Review candidate only.


def test_both_passes_accept_independent_bounded_damage():
    symbols = packet(2047)
    symbols[21] ^= 1
    symbols[37] = None
    result = decode_packet(symbols, 37, {2047})
    assert result.status == "accepted"
    assert (result.corrected_bits, result.erased_bits) == (1, 1)
