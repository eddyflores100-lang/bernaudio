/* ═══════════════════════════════════════════════════════════════
   BernAudio — reveal.js
   Reveal on scroll compartido (landing + subs + futuras páginas).
   El contenido NUNCA puede quedar invisible:
   1) CSS solo oculta .reveal si <html> tiene clase "js".
   2) Sin IntersectionObserver o con movimiento reducido → todo visible.
   3) Si el observer está roto/bloqueado (0 revelados en 3 s) → todo visible.
   4) Cualquier error → todo visible.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (!revealEls.length) return;

  function revealAll() {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  try {
    if ("IntersectionObserver" in window && !reducedMotion) {
      var revealedCount = 0;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
            revealedCount++;
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealEls.forEach(function (el) { io.observe(el); });
      setTimeout(function () {
        if (revealedCount === 0) revealAll(); /* IO bloqueado → mostrar todo */
      }, 3000);
    } else {
      revealAll();
    }
  } catch (e) {
    revealAll();
  }
})();
