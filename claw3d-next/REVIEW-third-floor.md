# Third floor: deterministic status icon and scoped HTTP-to-WebSocket bridge

The existing POST /api/sofia-ops/events stores sanitized metadata in server RAM.
The browser worldStore polls it; that route does not broadcast to Gateway sockets.
Custom status JSON was neither normalized by eventBus nor isolated to floor 3.
Jules session 10743076623203680819 reviewed the transport architecture. Its
unrelated .gitignore artifact is intentionally excluded.

## Backend

New POST /api/sofia-ops/events/third-floor, staging flag
SOFIA_THIRD_FLOOR_TELEMETRY=1. Original generic API remains unchanged.
Require SOFIA_OPS_EVENT_TOKEN bearer (never supplied to browser), JSON <=16KB,
60 authorized requests/minute, and strict metadata fields. Keep latest100runs
for5minutes. Deliver local namespace sofia.ops on the EXISTING authenticated
browser Gateway proxy socket only after matching hello-ok with operator read/admin.
No upstream OpenClaw publisher RPC, agent invocation, new service or LLM.
Outer Gateway seq is untouched. Slow readers with >128KB buffered skip telemetry;
reconnection replays retained latest states after hello. Cleanup on close/error.

Contract:
{"id":"run-123-start","source":"n8n","floorId":"dev-third","agentId":"n8n-reviewer","runId":"run-123","sequence":1,"status":"workflow.running"}
Statuses: workflow.running, workflow.completed, workflow.failed.
All other body fields are discarded; malformed contracts are rejected.

## Frontend

Optional patch installs ThirdFloorDirector.ts and ThirdFloorStatusIcon.tsx into
src/features/sofia-ops. OfficeScreen consumes only sofia.ops frames outside global
routing. Existing avatar heads get blue/green/red icons only after reaching the
physical third floor. Only addressed known avatars receive the fixed existing QA
station target; no clones, new floors, new physics, heavy animation or LLM.
Unknown, remote and error avatars are not moved. Duplicate/out-of-order updates
and delayed terminal events for another active run are ignored. State expires
in RAM (running5minutes, completed/failed30seconds), releasing prototype targets.
Existing generic world behavior, layout geometry and production remain unchanged.

## Validation

node claw3d-next/tests/telemetry-bridge.test.cjs /pinned/Claw3D/with/ws
node claw3d-next/tests/third-floor-director.test.cjs
node --test claw3d-next/tests/access-check.test.cjs
Generated TS/TSX syntax parsed successfully. Full Next compilation is required
for the new avatar component; rollout must retain old staging until healthy.

## Rollout / limitations

Fork only; do not merge original shared production-watched branch. Pin runtime
files and verify SHA256; install bridge after all existing auth overlays.
Frontend needs a staging-only rebuild. Keep original deploy/start command as rollback.
No n8n workflow has been edited or connected by this change. Live Android graphics
and real producer delivery need an explicit test event; local HTTP/WS tests do not
prove n8n integration. Production, login, Gateway and zooming-sparkle untouched.

## Local mobile visual preview

The staging diagnostic UI now includes **Testar 3º andar**. It sends a local browser event to a separate, ephemeral Director preview state for `main`. Controls select running (blue), completed (green), failed (red), or end the preview. All states expire in five minutes. Real telemetry for the same avatar always takes priority; ending a preview cannot erase real telemetry. This verifies rendering and deterministic targeting only, not n8n delivery or the HTTP/WebSocket bridge. No network requests, workflow execution or LLM calls are made by these controls.
