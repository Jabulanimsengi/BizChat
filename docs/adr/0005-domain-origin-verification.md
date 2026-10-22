# ADR 0005: Verify and match widget domains explicitly

## Status

Accepted

## Decision

Business hostnames are normalized with IDNA ASCII conversion, registered globally once, and
verified through a random DNS TXT challenge at `_bizchat-verification.<domain>`. Widget bootstrap
matches the browser origin hostname exactly to a `VERIFIED` record. `www.example.com` and
`example.com` are separate registrations.

The IETF-reserved `localhost` and `.localhost` names may be marked verified without DNS only when
the API is not running in production.

## Consequences

- One business cannot initialize its widget on another business's verified site.
- Wildcards, IP addresses, custom production ports, paths, credentials, and insecure production
  origins are rejected.
- External verification is subject to normal DNS propagation time.
