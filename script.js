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

const heroZipForm = document.querySelector("[data-hero-zip-form]");

if (heroZipForm) {
  const zipInput = heroZipForm.querySelector("input[name='serviceZip']");
  const zipMessage = heroZipForm.querySelector("[data-hero-zip-message]");
  const quoteLink = heroZipForm.querySelector("[data-hero-quote-link]");
  const serviceZips = new Set([
    "46301",
    "46302",
    "46303",
    "46304",
    "46307",
    "46308",
    "46311",
    "46312",
    "46319",
    "46320",
    "46321",
    "46322",
    "46323",
    "46324",
    "46325",
    "46327",
    "46342",
    "46347",
    "46356",
    "46360",
    "46368",
    "46373",
    "46375",
    "46383",
    "46384",
    "46385",
    "46391",
    "46393",
    "46394",
    "46401",
    "46402",
    "46403",
    "46404",
    "46405",
    "46406",
    "46407",
    "46408",
    "46409",
    "46410",
    "46411",
    "60411",
    "60417",
    "60418",
    "60419",
    "60422",
    "60423",
    "60425",
    "60430",
    "60432",
    "60433",
    "60435",
    "60436",
    "60438",
    "60443",
    "60448",
    "60449",
    "60452",
    "60461",
    "60462",
    "60466",
    "60467",
    "60473",
    "60475",
    "60477",
    "60478",
    "60484",
    "60487"
  ]);

  function cleanZip(value) {
    return String(value || "")
      .replace(/\D/g, "")
      .slice(0, 5);
  }

  function buildJotformUrl(zip) {
    const url = new URL("https://form.jotform.com/261075534581054");
    url.searchParams.set("q9_serviceArea", zip);
    url.searchParams.set("serviceArea", zip);
    return url.toString();
  }

  function resetZipState() {
    heroZipForm.classList.remove("is-in-area", "is-out-area", "has-error");
    if (zipMessage) zipMessage.textContent = "";
    if (quoteLink) quoteLink.hidden = true;
  }

  zipInput?.addEventListener("input", () => {
    zipInput.value = cleanZip(zipInput.value);
    resetZipState();
  });

  heroZipForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const zip = cleanZip(zipInput?.value);
    if (zipInput) zipInput.value = zip;

    resetZipState();

    if (zip.length !== 5) {
      heroZipForm.classList.add("has-error");
      if (zipMessage) zipMessage.textContent = "Please enter a 5-digit ZIP code.";
      zipInput?.focus();
      return;
    }

    if (!serviceZips.has(zip)) {
      heroZipForm.classList.add("is-out-area");
      if (zipMessage) {
        zipMessage.textContent =
          "We are not servicing that ZIP code yet. Call or text us if you are close to our route edge.";
      }
      return;
    }

    heroZipForm.classList.add("is-in-area");
    if (zipMessage) zipMessage.textContent = "Good news, you're in our area.";
    if (quoteLink) {
      quoteLink.href = buildJotformUrl(zip);
      quoteLink.hidden = false;
      quoteLink.focus();
    }
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
