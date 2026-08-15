# Third-party notices

WorkIsland includes browser-ready copies of the following open-source libraries under
`src/renderer/vendor/`:

- React and React DOM, Copyright Meta Platforms, Inc. and affiliates (MIT)
- React Markdown and the unified/remark ecosystem, Copyright their respective contributors (MIT)
- Zustand store bindings, Copyright their respective contributors (MIT)

The vendored files contain runtime code only; WorkIsland-specific UI and product logic
lives outside `src/renderer/vendor/`. Upstream project names and copyrights are
retained for attribution. Each project is distributed under the MIT License:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Agent icon assets

`claude.svg`, `codebuddy.svg`, `copilot.svg`, `cursor.svg`, `gemini.svg`,
`hermes.svg`, `kimi.svg`, `opencode.svg`, `pi.svg`, `trae.svg`, and `zcode.svg`
are derived from Lobe Icons `@lobehub/icons-static-svg@1.94.0`, Copyright LobeHub
contributors, and are distributed under the MIT License printed above.

`sara.svg` comes from the Sara Agent desktop application's public assets at
`Nexvisora-Research/sara-agent`. It is included only to identify the compatible Sara
connector; the Sara name and logo remain the property of their respective owner.

`agent.svg` is adapted from Lucide's `bot` icon and is distributed under the ISC
License:

```text
Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Third-party product names and logos are used solely to identify compatible local
connectors. All trademarks remain the property of their respective owners. The exact
asset mapping and upstream identity are documented in `docs/AGENT_BRAND_ASSETS.md`.
