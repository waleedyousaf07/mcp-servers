# Publishing

This doc covers first-time publish, updates, and token setup for npm.

## First-time publish
From the repo root:
```
npm login
npm whoami
npm publish --workspace @waleedyousaf07/mcp-http --dry-run
npm publish --workspace @waleedyousaf07/mcp-http --access public
```

If your account requires 2FA for publish, add an OTP:
```
npm publish --workspace @waleedyousaf07/mcp-http --access public --otp=123456
```

## Publish updates
From the repo root:
```
npm version patch --workspace @waleedyousaf07/mcp-http
npm publish --workspace @waleedyousaf07/mcp-http
```

Use `minor` or `major` instead of `patch` when appropriate.

## Generate a new token and configure npm
1) Go to npmjs.com → Access Tokens → Generate New Token (Granular).
2) Enable `Publish` and `Bypass 2FA`.
3) Set it locally:
```
npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN
```

To verify:
```
npm whoami
```
