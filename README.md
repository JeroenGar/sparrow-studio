# sparrow/studio

**Free, open-source nesting software that runs in your browser.**

Arrange parts to use less material when laser cutting, CNC routing, or cutting fabric. sparrow/studio is a web-based 2D nesting editor powered by the [sparrow nesting algorithm](https://github.com/JeroenGar/sparrow). Import your shapes, adjust the layout, and watch the solver fit them together—no installation or account needed.

**[Open sparrow/studio →](https://sparrowstudio.app/)**

[![sparrow/studio showing the parts list, editable canvas and nesting controls](https://github.com/user-attachments/assets/4d84bb67-ff98-4310-82de-5350baa02427)](https://sparrowstudio.app/)

## From drawing to cutting layout

1. **Bring your parts.** Import SVG or DXF contours, draw simple shapes, or try a bundled example.
2. **Set up the job.** Choose quantities, material width, permitted rotations, and clearance between parts.
3. **Nest and inspect.** Run the solver, follow the live search, and inspect its best geometry-checked layout. You can also arrange parts by hand.
4. **Export your work.** Download the current canvas as SVG or DXF. Export a project ZIP to keep an editable copy or continue with the native sparrow solver.

## Made for workshop layouts

- **Laser cutting and CNC routing:** plywood furniture parts, acrylic signs, templates, brackets, and sheet-metal profiles.
- **Textiles and garments:** fabric cutting layouts for clothing patterns, upholstery, and canvas.
- **Printing and packaging:** vector outlines for stickers, labels, cardboard blanks, and display pieces.
- **Research and experimentation:** bundled nesting benchmarks, configurable rotations and clearance, and live search previews.

The solver fits irregular shapes into a strip of fixed width while reducing the length used. For sheet stock, check that the resulting layout fits your sheet. SVG and DXF support selected contour types; review the import preview. Exports are part layouts for your design or CAM software, where you prepare toolpaths and machine settings. Nesting parts inside holes and automatic allocation across multiple sheets are not supported.

## Your files stay on your device

Import, editing, geometry checks, and nesting all run locally. The current project is saved automatically in this browser; export a project ZIP to keep a portable backup. No drawings are uploaded. The public site uses Cloudflare Web Analytics for traffic and performance, without sending project names, geometry, or file contents.

## Development

The TypeScript/React editor lives in `web/`. The Rust solver runs as WebAssembly in Web Workers, keeping the interface responsive during searches. SIMD and threaded builds are selected when supported, with compatibility fallbacks. No server-side solver is required.

See the **[build, development and testing instructions](web/README.md)**. GitHub Pages builds and tests the app before publishing each push to `main`.

For the algorithm and native command-line solver, visit [sparrow](https://github.com/JeroenGar/sparrow) and read [An open-source heuristic to reboot 2D nesting research](https://doi.org/10.48550/arXiv.2509.13329).

## License

sparrow/studio is licensed under the [MIT License](LICENSE). Dependencies retain their own licenses, including MPL-2.0 for jagua-rs; see the bundled [third-party notices](web/public/THIRD_PARTY_NOTICES.txt).
