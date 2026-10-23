/* BernAudio: optional entrance motion. Content is always visible without it. */
(function () {
  "use strict";
  var items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!items.length || reducedMotion || !("IntersectionObserver" in window)) return;
  try {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    items.forEach(function (item) { observer.observe(item); });
  } catch (error) {
    /* Animation is optional; CSS never hides the content. */
  }
})();
