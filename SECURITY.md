# Security Policy

## Intended use

KRONOS is designed for use on a **trusted local network** (your home Wi-Fi). It has **no authentication**: anyone who can reach the server can browse and download every file in the library folder.

- Do not expose it to the internet (no port forwarding, no public hosting).
- Use `--host 127.0.0.1` if you only need it on one computer.
- Keep private files out of the library folder.

The server only serves files inside the library folder and its own `web/` folder; path traversal attempts are rejected and covered by tests.

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.

Include steps to reproduce and the version you used. You can expect an initial reply within a few days.
