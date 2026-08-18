# Release v0.1.0-alpha.1

## Publish (maintainer)

1. Merge OSS readiness changes to `main`.
2. Create and push the tag:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

3. Wait for the [Release workflow](.github/workflows/release.yml) to finish.
4. Rename the published release to **ApiVoy v0.1.0-alpha.1 — First Public Alpha**.
5. Verify `SHA256SUMS.txt` and platform assets are attached.

Release notes source: [.github/release-notes/alpha.md](.github/release-notes/alpha.md)

## Verify downloads

### Checksums

```bash
sha256sum -c SHA256SUMS.txt
```

### CLI smoke test

```bash
apivoy-cli http-get https://httpbin.org/get
apivoy-cli run examples/collections/httpbin-smoke.json
```

### Windows MSI

Install the `.msi` from the release page, launch ApiVoy, send `https://httpbin.org/get` from the HTTP workbench.

## Local build note

Windows developer machines need OpenSSL build tooling (or vendored OpenSSL) for full workspace release builds. CI runners on GitHub Actions perform the official release builds.
