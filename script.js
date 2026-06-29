const header = document.querySelector("[data-header]");
const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector("#site-nav");
const heroVideo = document.querySelector(".hero-video");

function setHeaderState() {
  if (!header) return;
  const hasScrolled = window.scrollY > 12;
  header.classList.toggle("scrolled", hasScrolled);
}

function closeMenu() {
  nav.classList.remove("open");
  document.body.classList.remove("nav-open");
  header.classList.remove("menu-open");
  navToggle.setAttribute("aria-expanded", "false");
}

setHeaderState();
window.addEventListener("scroll", setHeaderState);

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    document.body.classList.toggle("nav-open", isOpen);
    header.classList.toggle("menu-open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target.matches("a")) {
      closeMenu();
    }
  });
}

if (heroVideo?.dataset.videoSrc) {
  fetch(heroVideo.dataset.videoSrc, { method: "HEAD" })
    .then((response) => {
      if (!response.ok) return;
      heroVideo.src = heroVideo.dataset.videoSrc;
      heroVideo.addEventListener(
        "canplay",
        () => {
          heroVideo.classList.add("is-ready");
        },
        { once: true }
      );
      heroVideo.load();
    })
    .catch(() => {
      heroVideo.hidden = true;
    });
}

const reviewCarousel = document.querySelector("[data-review-carousel]");

if (reviewCarousel) {
  const slides = Array.from(reviewCarousel.querySelectorAll("[data-review-slide]"));
  const dots = Array.from(reviewCarousel.querySelectorAll("[data-review-dot]"));
  const previousButton = reviewCarousel.querySelector("[data-review-prev]");
  const nextButton = reviewCarousel.querySelector("[data-review-next]");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeIndex = 0;
  let reviewTimer;

  function showReview(nextIndex) {
    if (!slides.length) return;
    activeIndex = (nextIndex + slides.length) % slides.length;

    slides.forEach((slide, index) => {
      const isActive = index === activeIndex;
      slide.hidden = !isActive;
      slide.classList.toggle("active", isActive);
    });

    dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.classList.toggle("active", isActive);
      dot.setAttribute("aria-pressed", String(isActive));
    });
  }

  function stopReviewTimer() {
    if (reviewTimer) window.clearInterval(reviewTimer);
  }

  function startReviewTimer() {
    stopReviewTimer();
    if (prefersReducedMotion.matches || slides.length < 2) return;
    reviewTimer = window.setInterval(() => showReview(activeIndex + 1), 6500);
  }

  previousButton?.addEventListener("click", () => {
    showReview(activeIndex - 1);
    startReviewTimer();
  });

  nextButton?.addEventListener("click", () => {
    showReview(activeIndex + 1);
    startReviewTimer();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      showReview(index);
      startReviewTimer();
    });
  });

  reviewCarousel.addEventListener("mouseenter", stopReviewTimer);
  reviewCarousel.addEventListener("mouseleave", startReviewTimer);
  reviewCarousel.addEventListener("focusin", stopReviewTimer);
  reviewCarousel.addEventListener("focusout", startReviewTimer);

  showReview(0);
  startReviewTimer();
}

const gatedMaps = Array.from(document.querySelectorAll("[data-map-gate]"));

if (gatedMaps.length) {
  let modifierKeyDown = false;
  let touchMapTimer;

  function setMapGateState(isActive) {
    gatedMaps.forEach((map) => {
      map.classList.toggle("map-is-active", isActive);
    });
  }

  function activateTouchMap() {
    window.clearTimeout(touchMapTimer);
    setMapGateState(true);
    touchMapTimer = window.setTimeout(() => {
      if (!modifierKeyDown) setMapGateState(false);
    }, 7000);
  }

  window.addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey) return;
    modifierKeyDown = true;
    setMapGateState(true);
  });

  window.addEventListener("keyup", (event) => {
    modifierKeyDown = event.metaKey || event.ctrlKey;
    setMapGateState(modifierKeyDown);
  });

  window.addEventListener("blur", () => {
    modifierKeyDown = false;
    setMapGateState(false);
  });

  gatedMaps.forEach((map) => {
    map.querySelector("[data-map-gate-message]")?.addEventListener("click", activateTouchMap);
    map.querySelector("[data-map-gate-message]")?.addEventListener("touchstart", activateTouchMap, {
      passive: true,
    });
  });
}
