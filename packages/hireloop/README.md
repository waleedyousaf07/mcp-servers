# MCP HireLoop

Thin MCP wrapper for a running HireLoop backend service.

## Tools

- `hireloop.run_start`
- `hireloop.run_active`
- `hireloop.run_status`
- `hireloop.run_results`
- `hireloop.run_resume`
- `hireloop.run_next`
- `hireloop.run_cancel`
- `hireloop.run_delete`
- `hireloop.jobs_approve`
- `hireloop.job_delete`
- `hireloop.job_retry`
- `hireloop.start_new_run` (alias: start + background progression trigger)
- `hireloop.status_run` (alias)
- `hireloop.continue_run` (alias)
- `hireloop.cancel_run` (alias)
- `hireloop.delete_run` (alias)

## Slack Commands (via Geni hireloop profile)

- `start-new-run`
- `status-run`
- `status-run <run_id>`
- `continue-run`
- `cancel-run <run_id>`
- `delete-run <run_id>`

## Quick start

```bash
HIRELOOP_BASE_URL=http://127.0.0.1:8787 npx @waleedyousaf07/mcp-hireloop@latest
```

See `setup.md` for local development notes.

## Retry Notes

- `hireloop.job_retry` accepts either:
  - `job_id` (existing behavior), or
  - `fingerprint` (+ optional `run_id`) to explicitly re-introduce an older job into a run.
