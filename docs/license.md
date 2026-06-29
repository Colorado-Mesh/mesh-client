# License

Mesh-Client application source (Electron main, preload, renderer, and shared TypeScript) is released under the **MIT License** below.

## Bundled Reticulum sidecar (AGPL-3.0)

Release builds may bundle `mesh-client-reticulum`, a separate executable built from [`reticulum-sidecar/`](../reticulum-sidecar/) that links AGPL-licensed Reticulum/LXMF crates. That binary is **not** MIT-licensed; it is **AGPL-3.0**. It runs as a child process only — no AGPL source is compiled into the MIT application layers.

- Sidecar source: [`reticulum-sidecar/`](../reticulum-sidecar/) in this repository
- Architecture: [docs/reticulum.md](reticulum.md)
- Attribution: [docs/credits.md](credits.md) (Ratspeak / rsReticulum / rsLXMF)

If you distribute builds that include the sidecar, comply with AGPL-3.0 source-offer requirements for that component.

## MIT License (application code)

```text
MIT License

Copyright (c) 2026 Mesh-Client Contributors

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
