# Verified Agent Catalog Design

## Goal

Only show agent integrations that have a documented local event interface and can be verified by a real event. Remove speculative connection UX, repair TRAE IDE against its current official Hooks feature, and make the DeepSeek Harness bridge safe and portable.

## Product scope

- Remove the guided custom-agent connection section and its renderer/main-process IPC surface.
- Do not add MiMo Code or TRAE Work because neither currently publishes a local lifecycle Hook contract suitable for WorkIsland.
- Keep TRAE CLI as a separate, already-supported product.
- Offer TRAE IDE only if its current v3.5.66+ Hooks format can be installed and a real event reaches WorkIsland. A written configuration alone is not connected.
- Keep DeepSeek Harness, because its locally deployed profile accepts bundles. Installation must discover the running `DSH_HOME`, profile, and port rather than assume a username or location.

## DeepSeek Harness reliability

DSH lifecycle events may cause more than one WorkIsland event in the same millisecond. Writes to `~/.flux/dsh-workisland-bridge.json` must therefore be serialized and atomic. Health checks must reject malformed configuration and the test suite must cover concurrent verification writes, arbitrary home/profile paths, and non-default ports.

The packaged bridge remains installed from WorkIsland's runtime `resourcesPath`, so another user receives the same bridge without depending on this repository. Users still need an initialized, running DSH profile, a working `pnpm`, one explicit Connect action, and a DSH restart after installation.

## Verification

- Static settings tests prove the custom connection UI is absent and unsupported products are not advertised.
- TRAE IDE is tested by installing the current official Hook configuration and sending a real prompt from the installed application. If no event arrives, it stays absent from the catalog.
- DSH unit tests reproduce concurrent writes and validate portable profile discovery.
- The full test suite, package build, installed application launch, and settings smoke test must pass.

