# Third-party notices

## MediaRemote Adapter

WorkIsland bundles MediaRemote Adapter v0.7.6 by Jonas van den Berg to read and
control the macOS system media session. It is distributed under the BSD
3-Clause License. The complete license text is included beside the bundled
framework at `Resources/mediaremote-adapter/LICENSE`.

Source: https://github.com/ungive/mediaremote-adapter

## Renderer libraries

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
