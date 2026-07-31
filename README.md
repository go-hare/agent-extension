# agent-extension

Browser agent extension (MV3) — functional clone of Claude in Chrome 1.0.81.

Self-hosted API + side panel agent loop, with **Claude Code / Desktop open MCP** via native messaging.

## Fixed extension ID

This fork uses a **self-generated RSA public key** in the manifest (`key`) so the Chrome extension ID is stable across Load unpacked paths and does **not** collide with the Chrome Web Store “Claude in Chrome” id.

| | |
|---|---|
| **Extension ID** | `bbkeopmjdjdiiaahndbbjhckdbgblpjn` |
| **Store Claude in Chrome** | `fcoeoabgfenejglbffodgkkbkcdhcgfn` (can coexist) |
| Public key | `keys/extension-public.b64` (committed) |
| Private key | `keys/extension.pem` (**gitignored** — keep offline) |
| ID source of truth | `keys/extension-id.txt` |

Origin for native host `allowed_origins`:

```text
chrome-extension://bbkeopmjdjdiiaahndbbjhckdbgblpjn/
```

### Claude Code / CLI whitelist

Allow this id on the host side (env name may vary by CLI build), for example:

```bash
export CLAUDE_CHROME_EXTENSION_IDS=bbkeopmjdjdiiaahndbbjhckdbgblpjn
```

Or merge into the native messaging host JSON:

```json
"allowed_origins": [
  "chrome-extension://bbkeopmjdjdiiaahndbbjhckdbgblpjn/"
]
```

## Develop & load

```bash
npm install
npm run build
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

Confirm the card shows id **`bbkeopmjdjdiiaahndbbjhckdbgblpjn`**. If it is random, the built `dist/manifest.json` is missing `key` — rebuild from a clean tree that includes `keys/extension-public.b64`.

Options page: Base URL + API key for the side-panel agent (self-hosted / proxy). Side panel: `Cmd/Ctrl+E` or toolbar action.

## Connect Claude Code (open MCP)

1. Build + Load unpacked as above (fixed id).
2. Put the id in CLI `CLAUDE_CHROME_EXTENSION_IDS` / host `allowed_origins`.
3. In Claude Code: **Connect local** / open browser MCP (wording depends on CLI version).
4. Extension should receive `mcp_connected` over `chrome.runtime.connectNative`.
5. First browser tool in a session is typically `tabs_context_mcp` (bridge defaults **`createIfEmpty: true`** when omitted).

### MCP notes

- **Single MCP client** at a time is the practical model (one native port session).
- **`tabs_create_mcp`**: optional `url` (`http://` / `https://`, protocol may be omitted → https). Omit / empty → `chrome://newtab`.
- **`update_plan`**: official densable fields `domains[]` + `approach[]`; also accepts free-text `plan` (string or string[]) which is normalized into `approach`.
- **`file_upload`**: host expands local paths → base64 `files: [{ data, name, mimeType }]`. **Required** target: `ref` (from `read_page` / `find`) **or** `coordinate`. Files alone are not enough. Native messaging message size is ~**1MB**; keep each file well under that after base64 (~700KB raw is a safe guide).
- Bridge allowlist includes automation + MCP tab tools, `file_upload`, `update_plan`, `shortcuts_*` (see `MCP_BRIDGE_TOOLS` in `src/mcp/bridge.ts`).
- Permissions for MCP use an isolated permission manager; domain-transition “Always continue” is still persisted.

## Scripts

| Script | |
|--------|--|
| `npm run dev` | Vite + CRX HMR |
| `npm run build` | `tsc --noEmit` + production `dist/` |
| `npm run typecheck` | Types only |
| `npm run zip` | Zip `dist/` for sharing |

## License / origin

Internal functional clone for self-hosted use. Not affiliated with Anthropic. Do not ship the private `keys/extension.pem` or reuse this id for a public store listing without rotating keys.

## 链接
- [((https://linux.do/))](https://linux.do/) — linux.do 社区
