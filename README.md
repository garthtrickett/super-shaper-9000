# 🏄‍♂️ Super Shaper 9000

**High-Performance, Cloud-Native Surfboard Design Tool.**

https://super-shaper-9000.onrender.com/

Super Shaper 9000 is a specialized CAD application built for the modern surfboard shaper. It combines the precision and speed of a native desktop application with the accessibility of a web tool. 

## 🧠 The Sovereign Core Architecture

Unlike traditional web apps that perform heavy math in JavaScript, Super Shaper 9000 uses a **Sovereign Core** design:

- **Engine (`/surfer-core`):** A high-performance geometry engine written in **Rust**. It handles all Bezier curve evaluations, 3D mesh generation (B-Rep), and physical volume integrations.
- **Bridge (`/surfer-wasm`):** The engine is compiled to **WebAssembly (WASM)** and runs in a dedicated **Web Worker**, ensuring the UI never stutters, even during complex mesh updates.
- **Interface:** A reactive, stateless UI built with **Lit** and **Tailwind CSS v4**, communicating with the Rust core via zero-copy buffer transfers.

## ✨ Key Features

- **Precision Bezier Controls:** Advanced G2 (Curvature) continuity solvers for ultra-smooth rails and rockers.
- **Pro-Grade Analysis:** Built-in Zebra Flow reflection analysis, Foil Ratio heatmaps, and Curvature Combs.
- **Interoperability:** Native support for importing/exporting `.s3dx` (Shape3d) and `.brd` (BoardCAD/AkuShaper) files.
- **4-Way Viewport:** Professional CAD layout with Top, Side, Profile, and Perspective views.
- **Offline First:** Powered by a local-first architecture—your designs stay with you.

## 🚀 Quick Start

### For Shapers
You can use the hosted version immediately at: **https://super-shaper-9000.onrender.com/**

### For Developers
This project uses **Nix** to ensure a perfectly reproducible build environment.

1. Install Nix and [direnv](https://direnv.net/).
2. Clone the repo: `git clone https://github.com/your-username/super-shaper-9000.git`
3. Allow the environment: `direnv allow` (This installs the Rust toolchain, JDK, Node, Bun, and Android SDK automatically).
4. Start the dev server: `npm run dev`

## 🛠 Tech Stack

- **Logic:** Rust (Nightly), Rayon (Parallelization), Glam (SIMD Math)
- **Frontend:** Lit, Effect-TS, Preact Signals, Three.js
- **Build/Runtime:** Bun, Vite, Wasm-bindgen
- **Environment:** Nix (Flakes)

## 📜 License

Super Shaper 9000 is licensed under the **GNU Affero General Public License (AGPL v3)**. 

*Why AGPL?* We believe in open tools for shapers. If you build a service using Super Shaper 9000, the community deserves to benefit from any improvements you make to the core engine. 

--- 

*Crafted with precision for the next generation of surfboard design.*
