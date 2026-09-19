# Control load run

Date: 2026-09-19T18:35:25.484Z
Clients requested: 1500. Duration: 300s. Target: http://127.0.0.1:18090

## Result

- Clients that joined: 1500/1500 (100.0%)
- Join wave: 365 ms to join, 959 ms until every socket was open
- Acknowledged the preparation: 500/1500 (33.3%)
- Acknowledged before the cue deadline: 500/1500 (33.3%)
- Clock ready when acknowledging preparation: 500/1500 (33.3%)
- Knew about the cue by its moment: 500/1500 (33.3%)
-   of which recovered it from a snapshot after reconnecting: 0
- Cue margin (warning before the moment): n=500 p50=4955.4ms p95=4964.2ms p99=4967.1ms max=4986.8ms
- Join latency: n=1500 p50=182.0ms p95=329.1ms p99=331.9ms max=349.6ms
- Reconnected mid-run: 150
- Joins shed by the rate limiter and retried: 0
- Sockets that needed a retry to open: 0
- Client-side errors: 0
- Worker stage when the cue was sent: validate
- Worker final stage: complete
- Worker diagnostics: 0
- Connected sockets immediately after the join wave: 1500
- Connected sockets at the end of the run, before teardown: 1500
- Registered identities: 1501 (includes one reachability probe without a socket)
- Reassignment committed to bass: 1000/1000 targeted devices
- Effective transport at the end: playing

## Server event-loop delay

Measured inside the control process. Delay here means sockets were waiting.

```json
{
  "devices": 1501,
  "connectedDevices": 1500,
  "revision": 226172,
  "eventLoopLagMs": {
    "count": 2748,
    "p50": 8.564899999997579,
    "p95": 16.436600000000908,
    "p99": 39.31919999999809,
    "max": 76.11109999999826
  }
}
```

## What this does not show

Every client here is a loopback socket on the same machine as the server. This measures whether
the control process survives the connection count and still delivers cues on time. It says
nothing about venue Wi-Fi, radio congestion, NAT tables in the access points, phones sleeping or
backgrounding, or whether any sound was produced. No audio was played and no screen was rendered.
A passing run here is a necessary condition for the concert, not evidence that it will work.

## Exclusions and late clients

1000 of 1500 simulated devices did not acknowledge before the cue deadline. The process exited 1. See verification.md for the probe lifecycle diagnosis and corrected reruns.
