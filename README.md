# GCode Diff 3D

![GCode Diff 3D icon](public/icon.png)

A web app that visualizes the diff between two GCode files in 3D space.

## Demo
https://nyarurato.github.io/GcodeDiff/

### Basic Diff Algorithm

Each GCode file is parsed into a list of **move segments** (G0/G1 straight lines, G2/G3 arcs interpolated into line segments).

Every segment gets a **key** — a string encoding the command type and start/end coordinates (rounded to 3 decimal places). Arc moves share one key per arc so they are compared as a logical unit, not as individual interpolation steps.

Diff is a **set-based comparison**:

```
keysB = Set of all keys in B
keysA = Set of all keys in A

for each segment in A:
    status = "common"  if key ∈ keysB
             "only-a"  otherwise

for each segment in B:
    status = "common"  if key ∈ keysA
             "only-b"  otherwise
```

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build
```

## Tech Stack

| Library | Purpose |
|---|---|
| [Three.js](https://threejs.org/) | 3D rendering |
| [Vite](https://vitejs.dev/) | Build tool & dev server |
| [gcode-toolpath](https://github.com/cncjs/gcode-toolpath) | gcode parser |

## License

MIT
