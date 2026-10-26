# Security policy

This is an early-stage browser prototype, not a hardened privacy product.

- Do not use it for high-risk or sensitive activity until its threat model and implementation have been independently reviewed.
- Report vulnerabilities privately to the repository maintainer rather than posting exploitable details in public issues.
- Never load untrusted extensions. Extension support loads unpacked Chromium extension directories and is experimental.
- Privacy levels are content-blocking policies, not anonymity guarantees. They do not hide your IP address, defeat fingerprinting, or prevent OS/network-level logging.
- Session destruction is best-effort cleanup of application-managed state. It is not forensic secure deletion of RAM, swap, filesystem journals, DNS caches, crash reports, or saved files.
