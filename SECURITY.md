# Security Policy

We take the security of our project seriously and appreciate your efforts to help us keep it safe.

## Headless / Docker remote surface

When Mesh-Client runs in **server mode** (`MESH_CLIENT_HEADLESS` or inside a container), it exposes an HTTP + WebSocket remote-control endpoint (default bind `0.0.0.0:8000`). Treat this as a trusted-operator surface:

- Set `MESH_CLIENT_REMOTE_TOKEN` for any non-loopback bind (empty token is refused on `0.0.0.0` / LAN hosts).
- Terminate TLS at a reverse proxy; prefer private networks.
- `/health` is intentionally unauthenticated (liveness only).
- See [docs/headless-server.md](docs/headless-server.md).

## Reporting a Vulnerability

If you believe you have found a security vulnerability, please **do not report it via a public GitHub issue**. Instead, please

- send an email to: **nv0n@coloradomesh.org** or,
- DM nv0n on our Discord

To help us investigate and triage the issue as quickly as possible, please include:

- **Type of issue** (e.g., buffer overflow, SQL injection, cross-site scripting).
- **Full paths of source files** related to the manifestation of the issue.
- **Step-by-step instructions** to reproduce the vulnerability.
- **Proof-of-concept or exploit code** (if possible).
- **Impact of the issue**, including how an attacker might exploit it.

## Response Timeline

We strive to respond to all reports within **48 hours**. Once we confirm a vulnerability, we will work to address it and keep you updated on the expected timeline for a patch.

## Supported Versions

We currently provide security updates only for the code in `main` and the latest release.

## Disclosure Policy

We encourage responsible disclosure. Please do not make any security vulnerability public until we have had sufficient time to evaluate, patch, and deploy a fix.
