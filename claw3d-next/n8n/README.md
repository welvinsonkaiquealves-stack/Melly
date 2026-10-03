# Isolated n8n event producer

Created in Railway n8n, personal project Welvinson Alves. Workflow: cDGjg3kyaCXvSHJP. URL: https://n8n-production-d9d9.up.railway.app/workflow/cDGjg3kyaCXvSHJP

Status: inactive, manual trigger only. Node and SDK validation pass. Not executed: dedicated event credential is not configured. Existing bot workflows were not changed. No WhatsApp, calendar, LLM, scheduled trigger or external patient data.

Configure one httpTemplatedCustomAuth credential named Sofia Third Floor Staging Events, using the template {"headers":{"Authorization":"Bearer {{api_key}}"}}. Set api_key privately to the existing SOFIA_OPS_EVENT_TOKEN value of sofia-claw3d-next. Assign it to both HTTP nodes. Never store this token in workflow parameters, code, chat or execution data. Do not reuse Evolution/OpenClaw credentials.

Then end the local visual preview, open the canary panel, and execute the manual workflow. Expect a real POST for workflow.running, then after 30 seconds workflow.completed; same runId based on $execution.id and increasing sequences 1/2. HTTP timeout 5s, workflow timeout 90s, redirects disabled, execution payload saving disabled. Successful transport and Android result still require verification after credential setup.
