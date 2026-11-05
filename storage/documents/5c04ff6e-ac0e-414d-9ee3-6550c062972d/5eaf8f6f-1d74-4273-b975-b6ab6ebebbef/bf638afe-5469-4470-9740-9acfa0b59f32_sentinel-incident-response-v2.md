# Sentinel SOC Incident & API Response Guide (v2)

## Authentication Protocol Upgrade
OAuth 2.1 mTLS is now enforced. Legacy ERR_AUTH_EXPIRED is replaced with RFC_TOKEN_REVOKED.
All auth endpoints now reside under /api/v2/secure/auth.