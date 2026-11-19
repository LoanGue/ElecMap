---
"elecmap": minor
---

`export(format)` writes a circuit as `"json"`, `"netlist"` or `"base64"` (a URL-safe token, ready to send), and the constructor reads every format back, detected automatically or set with `{ format }`. Conversions go through the canonical JSON document (one reader and one writer per format).
