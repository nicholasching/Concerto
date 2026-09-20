# Restore the public development tunnel

User requested the dev session and `htn.nicholasching.ca` back online. Starting tree includes the uncommitted OTC performance changes; preserve them and the existing live session.

Diagnosis: backend 8080, audience 3000 and admin 3001 were listening and returned HTTP 200. No cloudflared process was running; the public hostname returned HTTP 530. The existing private token file outside the repository was present. The server snapshot retained its existing epoch, stopped transport, show revision 3 and ten registered identities.

Action: started the existing cloudflared executable with `tunnel --no-autoupdate run --token-file` pointing to the saved absolute Windows token-file path. Used PowerShell `Start-Process -WindowStyle Hidden` with logs in ignored `runtime/local/cloudflare-restored.{stdout,stderr}.log`. No token value was printed, written into Git or supplied as an argument. Connector PID at launch: 46548, 2026-09-20 00:44:21 America/Toronto. App processes were not restarted and no audience/session mutation was sent.

Verification: the connector remained alive across subsequent independent tool calls and registered four QUIC connections. Public `/`, `/admin`, `/present`, `/upload` and `/api/health` all returned HTTP 200. Existing read-only operator verification passed HTTPS authentication, WSS snapshot and a clock round trip without allocating an audience identity. This restores the local dev tunnel; no Windows startup service or Railway deployment was created.
