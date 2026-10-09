# Contributing

Issues and pull requests are welcome. Keep changes focused, explain user impact, and include tests for security-sensitive behavior such as interaction verification, permissions, persistence, and authorization.

Before opening a pull request, run:

```powershell
npm test
npm run check
```

Do not include real bot tokens, interaction tokens, server/member IDs from private servers, message content, or local ticket-store files in issues or commits. Reproduce bugs with fabricated test data. OpenDesk deliberately avoids transcript capture and third-party runtime dependencies; discuss any change to those boundaries before implementing it.
