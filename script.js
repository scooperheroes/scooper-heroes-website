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
