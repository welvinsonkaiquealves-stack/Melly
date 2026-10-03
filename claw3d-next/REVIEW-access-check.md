# Staging browser access check

Adds a mobile “Testar acesso” button to `/office` only when `SOFIA_ACCESS_CHECK=1`.
The injected same-origin script observes the existing browser WebSocket before the
application initializes. Each explicit click sends only `status`, `sessions.list`
and `cron.list` on that authenticated socket. It does not create another session,
change pairing, write Gateway data, call LLMs or persist credentials. Administrative
permission is reported from the hello scopes, not inferred from read-only success.

The server wrapper remains behind the existing accessGate. It passes through all
other routes and RSC responses, preserves security headers, and inserts the script
before application scripts with a bounded HTML prefix buffer. The patch requires
one exact handler anchor and is idempotent. It changes neither server-v2.js nor the
authentication patches nor any 3D floor.

Validation: `node --test claw3d-next/tests/access-check.test.cjs`.

Deployment: fork only; no merge into the production-watched original branch.
Pin the three runtime files to their commit and verify SHA256 before patching.
Enable only on sofia-claw3d-next. Preserve all existing startup overlays.
Rollback: restore the previous staging start command and remove/disable
SOFIA_ACCESS_CHECK, then trigger a fresh staging deployment.

The phone's actual permissions remain unverified until its button test runs.
