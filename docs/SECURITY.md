# Security

Security for the MVP focuses on practical protection of stream access, provider credentials, and approval authority.

## Rules

- Do not expose IPTV provider credentials to mobile clients.
- Store secrets outside source control.
- Mask sensitive values in desktop UI.
- Use role-based permissions for approval actions.
- Keep audit records for stream approval decisions.
- Validate all API inputs.

## MVP Authentication

The first implementation may use a simple local operator authentication model. Before external deployment, add stronger session handling, password storage, and transport security.

## Stream Access

- Mobile clients should receive only approved stream metadata.
- Backend should be able to revoke or suspend match stream access.
- Direct provider URLs should be protected or proxied when required by provider contracts.

