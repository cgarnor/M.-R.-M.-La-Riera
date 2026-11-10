# Third-party notices

MRM Analysis Tool is distributed under the MIT licence (see `LICENSE`). It includes or is built
with the following open-source components. PoissonRecon and the JavaScript libraries are licensed
under permissive licences (MIT or ISC) that allow redistribution, provided their copyright notices
are kept. The Electron runtime (Chromium, Node.js) ships its own licence files (see below).

## Bundled executable

| Component | Version | Licence | Copyright / source |
|---|---|---|---|
| PoissonRecon (Screened Poisson Surface Reconstruction), Windows x64 | 18.76 | MIT | © 2015 Michael Kazhdan, <https://github.com/mkazhdan/PoissonRecon> |

SHA-256 of `native/win-x64/PoissonRecon.exe`:
`7f40af73039a865303cbdc38228b5c88582dff2295d282a76375e78146870876`

The full licence text is in `native/win-x64/PoissonRecon-LICENSE.txt` (installed next to the
executable in `resources/bin/`).

Kazhdan, M. & Hoppe, H. (2013). Screened Poisson Surface Reconstruction. *ACM Transactions on Graphics*, 32(3).

## JavaScript libraries included in the application bundle

| Package | Version | Licence | Source |
|---|---|---|---|
| three | 0.183.2 | MIT | <https://github.com/mrdoob/three.js> |
| three-mesh-bvh | 0.9.9 | MIT | <https://github.com/gkjohnson/three-mesh-bvh> |
| three-stdlib | 2.36.1 | MIT | <https://github.com/pmndrs/three-stdlib> |
| meshoptimizer | 1.3.0 | MIT | <https://github.com/zeux/meshoptimizer> |
| react, react-dom, scheduler, use-sync-external-store | 19.2.4 / 0.27.0 / 1.6.0 | MIT | <https://github.com/facebook/react> |
| @react-three/fiber | 9.5.0 | MIT | <https://github.com/pmndrs/react-three-fiber> |
| @react-three/drei | 10.7.7 | MIT | <https://github.com/pmndrs/drei> |
| its-fine | 2.0.0 | MIT | <https://github.com/pmndrs/its-fine> |
| react-use-measure | 2.1.7 | MIT | <https://github.com/pmndrs/react-use-measure> |
| zustand | 5.0.12 | MIT | <https://github.com/pmndrs/zustand> |
| lucide-react | 0.546.0 | ISC | <https://github.com/lucide-icons/lucide> |
| @babel/runtime | 7.29.2 | MIT | <https://github.com/babel/babel> |

## Desktop runtime

| Component | Version | Licence | Source |
|---|---|---|---|
| Electron (includes Chromium and Node.js) | 44.10.2 | MIT (Chromium: BSD-style and other open-source licences) | <https://github.com/electron/electron> |

The Windows build ships Electron's own `LICENSE.electron.txt` and `LICENSES.chromium.html`
in the installation folder.

## Build and test tools (not distributed)

Vite, TypeScript, @vitejs/plugin-react, electron-builder and tsx are used only to build and test
the application and are not included in the installer.
