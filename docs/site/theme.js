// Renders the `.em-math` blocks of the documentation with KaTeX (loaded from a CDN).
(function () {
  var blocks = document.querySelectorAll(".em-math");
  if (blocks.length === 0) return;
  var base = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = base + "katex.min.css";
  document.head.appendChild(css);
  var script = document.createElement("script");
  script.src = base + "katex.min.js";
  script.onload = function () {
    blocks.forEach(function (el) {
      try {
        katex.render(el.textContent || "", el, { displayMode: true, throwOnError: false });
      } catch {
        /* keep the raw LaTeX */
      }
    });
  };
  document.head.appendChild(script);
})();
