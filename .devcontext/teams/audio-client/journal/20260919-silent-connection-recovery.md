# Silent connection recovery — captain integration, 2026-09-19

The user reported intermittent tunnel disconnects and failed phone synchronization. The [integration investigation](../../integration/journal/20260919-sync-connectivity.md) records correlated Windows Wi-Fi/tunnel outages, the 90-second three-path clock comparison, the failing regression, changes and verification.

Changed participant connection and join code on integrated main: a 10-second validated-inbound-message watchdog resumes silent OPEN sockets; a 10-second HTTP abort deadline releases hanging joins without discarding identity. Existing backoff, replaced-tab behavior, snapshot recovery and clock thresholds remain. No contracts changed. This is software recovery evidence; phone acoustic and venue gates remain pending. Refresh existing participant pages before retesting.
