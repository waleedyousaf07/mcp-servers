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

For the Gmail package, use the same commands with the Gmail workspace name:
```
npm publish --workspace @waleedyousaf07/mcp-gmail --dry-run
npm publish --workspace @waleedyousaf07/mcp-gmail --access public
npm version patch --workspace @waleedyousaf07/mcp-gmail
npm publish --workspace @waleedyousaf07/mcp-gmail
```

For the Google Calendar package, use the same commands with the Calendar workspace name:
```
npm publish --workspace @waleedyousaf07/mcp-google-calendar --dry-run
npm publish --workspace @waleedyousaf07/mcp-google-calendar --access public
npm version patch --workspace @waleedyousaf07/mcp-google-calendar
npm publish --workspace @waleedyousaf07/mcp-google-calendar
```

For the Google Docs package, use the same commands with the Docs workspace name:
```
npm publish --workspace @waleedyousaf07/mcp-google-docs --dry-run
npm publish --workspace @waleedyousaf07/mcp-google-docs --access public
npm version patch --workspace @waleedyousaf07/mcp-google-docs
npm publish --workspace @waleedyousaf07/mcp-google-docs
```

For the Google Sheets package, use the same commands with the Sheets workspace name:
```
npm publish --workspace @waleedyousaf07/mcp-google-sheets --dry-run
npm publish --workspace @waleedyousaf07/mcp-google-sheets --access public
npm version patch --workspace @waleedyousaf07/mcp-google-sheets
npm publish --workspace @waleedyousaf07/mcp-google-sheets
```

For the HireLoop package, use the same commands with the HireLoop workspace name:
```
npm publish --workspace @waleedyousaf07/mcp-hireloop --dry-run
npm publish --workspace @waleedyousaf07/mcp-hireloop --access public
npm version patch --workspace @waleedyousaf07/mcp-hireloop
npm publish --workspace @waleedyousaf07/mcp-hireloop
```

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
