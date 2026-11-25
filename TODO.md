# TODO

- Canvas playground, editor-first (#36)
  - Phase 0: extract the drawing model (#39, done), then the netlist and the circuit import (#45)
  - Track A, canvas core: camera, gestures, pinch, hit testing, scene, painter, symbol sprites
  - Track B, editing: naming (C₁, rename), history and operations, fitting, moves (rest of #28)
  - Track C, main.ts split: state and format, plots and Bode, transfer, panels, share and splitter
  - Integration: controller, canvas editor behind a flag, in-place editing, schematic view, editor-first page, removal of the SVG editor
- Wire routing (#28): wires module (#33, done), routing module (#34)
- Release npm v0.1.0
- SECURITY.md and CONTRIBUTING.md
