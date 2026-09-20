import itertools
import json

import numpy as np
import pytest

from otc.protocol import decode_packet, decode_word, packet_layout
from otc.sampling import decode_tracks, find_phase
from otc.tracking import CameraScan, Sample, Track
from otc.validation import ROOT
from test_protocol import independent_word


def packet(device_id=31):
    word = independent_word(device_id)
    return [None, None, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, *word,
            *[1-bit for bit in word], None, None]


def decode(symbols, members=None, tag=22):
    return decode_packet(symbols, tag, set(range(2048)) if members is None else members,
                         packet_version="otc-v2")


def test_v2_vectors_match_independent_encoding_and_do_not_transmit_run_tag():
    for golden in json.loads((ROOT/'packages/contracts/generated/otc-v2-golden-packets.json').read_text()):
        assert golden['symbols'] == packet(golden['deviceId'])
        assert len(golden['symbols'])*golden['symbolMs'] == 11750
        for tag in (0, 22, 255):
            assert decode(golden['symbols'], tag=tag).device_id == golden['deviceId']
    assert packet_layout('otc-v1').symbols == 55


@pytest.mark.parametrize('device_id', [0, 1, 31, 1024, 2047])
def test_joint_recovers_different_four_bit_losses_in_each_pass(device_id):
    symbols = packet(device_id)
    symbols[13:17] = [None]*4
    symbols[33:37] = [None]*4
    assert decode_word(symbols[13:29]).device_id is None
    assert decode_word([None if b is None else 1-b for b in symbols[29:45]]).device_id is None
    result = decode(symbols)
    assert (result.device_id, result.erased_bits, result.corrected_bits) == (device_id, 8, 0)
    assert result.reason == 'joint bounded repeat recovery'


def test_every_up_to_three_error_pattern_recovers_in_joint_32_bit_word():
    original = packet(31)
    for count in (1, 2, 3):
        for positions in itertools.combinations(range(32), count):
            symbols = original.copy()
            for pos in positions:
                symbols[13+pos] ^= 1
            result = decode(symbols)
            assert (result.device_id, result.corrected_bits) == (31, count), positions


@pytest.mark.parametrize('device_id', [0, 1, 1024, 2047])
def test_joint_mixed_errors_and_erasures_within_distance_eight_bound(device_id):
    rng = np.random.default_rng(12)
    for errors in range(4):
        for erased in range(8-2*errors):
            for _ in range(8):
                symbols = packet(device_id)
                positions = rng.permutation(32)
                for bit in positions[:errors]:
                    symbols[13+bit] ^= 1
                for bit in positions[errors:errors+erased]:
                    symbols[13+bit] = None
                result = decode(symbols)
                assert result.device_id == device_id


def test_joint_does_not_guess_using_participant_membership_or_conflicting_passes():
    symbols = packet(0)
    symbols[29:45] = packet(1)[29:45]
    assert decode(symbols, {0, 1}).status == 'ambiguous'
    assert decode(symbols, {0}).device_id is None
    symbols[13:45] = [None]*32
    symbols[13] = 0
    assert decode(symbols, {0}).device_id is None
    assert decode(packet(31), {0}).reason == 'ID outside participant set'


def test_joint_rejects_four_error_tie_and_recovers_one_entire_missing_pass():
    symbols = packet(0)
    different = [i for i,(a,b) in enumerate(zip(independent_word(0), independent_word(3))) if a != b]
    assert len(different) == 4
    for bit in different[:2]:
        symbols[13+bit] ^= 1
        symbols[29+bit] ^= 1
    assert decode(symbols).device_id is None
    for start in (13, 29):
        symbols = packet(31)
        symbols[start:start+16] = [None]*16
        assert decode(symbols).device_id == 31


def track(device_id=31, phase=500, missing_slots=(), fps=30, trim_ms=None):
    symbols = packet(device_id)
    samples = []
    for pts in np.arange(0, phase+11750, 1000/fps):
        slot = int(np.floor((pts-phase)/250))
        if not 0 <= slot < 47 or symbols[slot] is None or slot in missing_slots:
            continue
        if trim_ms is not None and pts < trim_ms:
            continue
        rgb = ((255,0,0), (0,102,255))[symbols[slot]]
        samples.append(Sample(float(pts if trim_ms is None else pts-trim_ms), 30,30,10,16,rgb))
    return Track(f'phone-{device_id}', samples)


def observe(tracks):
    return decode_tracks(CameraScan(tracks,100,100,500,None,0),
                         {'packetVersion':'otc-v2','participantIds':[0,1,2,3,31], 'runTag':22,
                          'palette':{'zero':'#FF0000','one':'#0066FF'}}, 'camera')


@pytest.mark.parametrize('fps', [24,30,60])
@pytest.mark.parametrize('missing', [(), (2,3), (4,5), (2,3,4,5), (2,3,4,5,7)])
def test_missing_pilots_and_partial_preamble_recover_with_measured_reference(fps, missing):
    seen,_,_,_ = observe([track(missing_slots=missing,fps=fps)])
    assert [(o['deviceId'],o['status']) for o in seen] == [(31,'accepted')]


def test_recording_can_start_at_preamble_and_independent_phone_phases_are_allowed():
    seen,_,phase,_ = observe([track(trim_ms=2000)])
    assert seen[0]['deviceId'] == 31 and phase < 0
    seen,_,_,_ = observe([track(i, phase=500+offset) for i,offset in enumerate([0,100,200,300])])
    assert [(o['deviceId'],o['status']) for o in seen] == [(i,'accepted') for i in range(4)]


def test_v2_rejects_static_alternating_and_missing_color_reference():
    for style in ('static','alternating','all-red'):
        t = track()
        for sample in t.samples:
            bit = int(sample.pts_ms/250)%2 if style == 'alternating' else 0
            sample.rgb = ((255,0,0),(0,102,255))[bit]
        assert find_phase(t,zero_color='#FF0000',packet_version='otc-v2') is None
    assert observe([track(missing_slots=tuple(range(2,13)))])[0] == []


def test_preamble_supplies_color_reference_when_pilots_are_washed_to_white():
    t = track()
    for sample in t.samples:
        if 1000 <= sample.pts_ms < 2000:
            sample.rgb = (240,240,240)
    seen,_,_,_ = observe([t])
    assert seen[0]['deviceId'] == 31
    assert 'preamble color reference; pilot unavailable' in seen[0]['reasons']


def test_v2_finds_header_after_long_colored_status_screen():
    t = track(phase=3500)
    t.samples = [Sample(float(pts),30,30,10,16,(90,120,210))
                 for pts in np.arange(0,4000,1000/30)] + t.samples
    seen,_,_,_ = observe([t])
    assert seen[0]['deviceId'] == 31
