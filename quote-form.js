const quoteRoot = document.querySelector("[data-quote-form]");

if (quoteRoot) {
  const form = quoteRoot.querySelector(".quote-form");
  const panels = Array.from(quoteRoot.querySelectorAll("[data-step-panel]"));
  const successPanel = quoteRoot.querySelector("[data-success-panel]");
  const nextButton = quoteRoot.querySelector("[data-next]");
  const prevButton = quoteRoot.querySelector("[data-prev]");
  const submitButton = quoteRoot.querySelector("[data-submit]");
  const controls = quoteRoot.querySelector("[data-form-controls]");
  const message = quoteRoot.querySelector("[data-form-message]");
  const stepCount = quoteRoot.querySelector("[data-step-count]");
  const stepTitle = quoteRoot.querySelector("[data-step-title]");
  const progressBar = quoteRoot.querySelector("[data-progress-bar]");
  const zipGood = quoteRoot.querySelector("[data-zip-good]");
  const zipBad = quoteRoot.querySelector("[data-zip-bad]");
  const dateOptions = quoteRoot.querySelector("[data-date-options]");
  const timeOptions = quoteRoot.querySelector("[data-time-options]");
  const review = quoteRoot.querySelector("[data-review]");
  const emailFallback = quoteRoot.querySelector("[data-email-fallback]");
  const startedAtInput = quoteRoot.querySelector("[data-form-started-at]");
  const nonceInput = quoteRoot.querySelector("[data-form-nonce]");

  const backendUrl = window.SCOOPER_HEROES_FORM_ENDPOINT || "";
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

  const stepLabels = [
    "Service area",
    "Contact details",
    "Yard details",
    "Appointment",
    "Review"
  ];
  const requiredByStep = [
    ["zip", "dogCount", "serviceType"],
    ["firstName", "lastName", "phone", "email"],
    ["street", "city", "state", "lastCleaning", "preferredSchedule"],
    ["appointmentDate", "appointmentTime"],
    ["consent"]
  ];
  const weekdayAppointmentTimes = ["9:00 AM", "11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM", "7:00 PM"];
  const saturdayAppointmentTimes = ["9:00 AM", "11:00 AM", "1:00 PM", "2:00 PM"];
  const backendAnalyticsEvents = new Set([
    "form_viewed",
    "step_viewed",
    "zip_checked",
    "form_submitted"
  ]);
  const formStartedAt = Date.now();
  const formNonce = createNonce();
  let currentStep = 0;
  let lastZipTracked = "";
  let availabilityData = null;
  let availabilityPromise = null;

  if (startedAtInput) startedAtInput.value = String(formStartedAt);
  if (nonceInput) nonceInput.value = formNonce;

  function formData() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function createNonce() {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function track(eventName, detail = {}) {
    const payload = {
      event: eventName,
      detail,
      page: "quote-form",
      timestamp: new Date().toISOString()
    };
    const stored = JSON.parse(localStorage.getItem("scooperQuoteAnalytics") || "[]");
    stored.push(payload);
    localStorage.setItem("scooperQuoteAnalytics", JSON.stringify(stored.slice(-100)));
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);

    if (backendUrl && backendAnalyticsEvents.has(eventName)) {
      fetch(backendUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          type: "analytics",
          ...payload
        })
      }).catch(() => {});
    }
  }

  function setMessage(text, type = "info") {
    if (!message) return;
    if (!text) {
      message.hidden = true;
      message.textContent = "";
      message.dataset.type = "";
      return;
    }
    message.hidden = false;
    message.textContent = text;
    message.dataset.type = type;
  }

  function cleanZip(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
  }

  function scrollToForm() {
    quoteRoot.querySelector(".quote-card")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function zipIsSupported() {
    const zip = cleanZip(form.elements.zip?.value);
    return zip.length === 5 && serviceZips.has(zip);
  }

  function updateZipResult() {
    const zip = cleanZip(form.elements.zip?.value);
    if (form.elements.zip) form.elements.zip.value = zip;
    const isComplete = zip.length === 5;
    const supported = zipIsSupported();
    zipGood.hidden = !(isComplete && supported);
    zipBad.hidden = !(isComplete && !supported);
    if (isComplete && zip !== lastZipTracked) {
      lastZipTracked = zip;
      track("zip_checked", { zip, supported });
    }
  }

  function validateStep(index) {
    setMessage("");
    const data = formData();
    const missing = requiredByStep[index].filter((name) => !data[name]);

    if (index === 0) {
      updateZipResult();
      if (cleanZip(data.zip).length !== 5) {
        setMessage("Enter a 5-digit ZIP code so we can check the route area.", "error");
        return false;
      }
      if (!zipIsSupported()) {
        setMessage("That ZIP is outside the current service area, so appointment fields are hidden for now.", "error");
        return false;
      }
    }

    if (index === 1 && data.email && !form.elements.email.validity.valid) {
      setMessage("Enter a valid email address so we can send your confirmation.", "error");
      return false;
    }

    if (missing.length) {
      setMessage("Fill out the required fields before moving forward.", "error");
      const first = form.elements[missing[0]];
      if (first?.focus) first.focus();
      return false;
    }

    return true;
  }

  function renderAppointments({ force = false } = {}) {
    if (!dateOptions || !timeOptions) return;

    if (force) {
      availabilityData = null;
      availabilityPromise = null;
    }

    if (availabilityData) {
      renderDateOptions();
      return;
    }

    dateOptions.innerHTML = `<p class="slot-status">Loading live availability...</p>`;
    timeOptions.innerHTML = `<p class="slot-status">Select a day to see open windows.</p>`;
    loadAvailability()
      .then((data) => {
        availabilityData = data;
        renderDateOptions();
      })
      .catch(() => {
        dateOptions.innerHTML = `<p class="slot-status error">Unable to load live availability. Please call or text us to schedule.</p>`;
        timeOptions.innerHTML = "";
      });
  }

  function loadAvailability() {
    if (availabilityPromise) return availabilityPromise;
    availabilityPromise = backendUrl
      ? loadAvailabilityFromBackend()
      : Promise.resolve(buildPreviewAvailability());
    return availabilityPromise;
  }

  function loadAvailabilityFromBackend() {
    return fetchJsonp(`${backendUrl}?type=availability&cacheBust=${Date.now()}`)
      .then((data) => {
        if (!data?.ok || !Array.isArray(data.dates)) {
          throw new Error("Invalid availability response.");
        }
        return data;
      });
  }

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callbackName = `scooperHeroesAvailability${Date.now()}${Math.random().toString(16).slice(2)}`;
      const script = document.createElement("script");
      const separator = url.includes("?") ? "&" : "?";
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Availability request timed out."));
      }, 12000);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.src = `${url}${separator}callback=${callbackName}`;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Availability request failed."));
      };
      document.head.appendChild(script);
    });
  }

  function buildPreviewAvailability() {
    const formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const dates = [];
    let offset = 1;

    while (dates.length < 7) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const day = date.getDay();
      if (day !== 0) {
        const times = (day === 6 ? saturdayAppointmentTimes : weekdayAppointmentTimes)
          .map((time) => ({ time, available: true }));
        dates.push({
          date: localIsoDate(date),
          label: formatter.format(date),
          day,
          blackout: false,
          times
        });
      }
      offset += 1;
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      dates
    };
  }

  function renderDateOptions() {
    dateOptions.innerHTML = "";
    timeOptions.innerHTML = `<p class="slot-status">Select a day to see open windows.</p>`;

    const dates = availabilityData?.dates || [];
    if (!dates.length) {
      dateOptions.innerHTML = `<p class="slot-status error">No appointment windows are currently available.</p>`;
      return;
    }

    dates.forEach((dateRecord) => {
      const hasAvailableTimes = dateRecord.times?.some((time) => time.available);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot-button";
      button.dataset.date = dateRecord.date;
      button.dataset.day = String(dateRecord.day);
      button.textContent = dateRecord.label || dateRecord.date;
      button.disabled = !hasAvailableTimes;
      if (!hasAvailableTimes) {
        button.title = dateRecord.blackout ? "Unavailable" : "Fully booked";
        button.setAttribute("aria-label", `${button.textContent} unavailable`);
      }
      if (form.elements.appointmentDate.value === dateRecord.date && hasAvailableTimes) {
        button.classList.add("selected");
        renderAppointmentTimes(dateRecord);
      }
      dateOptions.appendChild(button);
    });

    const selectedStillAvailable = dates.some((dateRecord) => (
      dateRecord.date === form.elements.appointmentDate.value
      && dateRecord.times?.some((time) => time.available)
    ));

    if (!selectedStillAvailable) {
      form.elements.appointmentDate.value = "";
      form.elements.appointmentTime.value = "";
    }
  }

  function renderAppointmentTimes(dateRecord = null) {
    if (!timeOptions) return;
    timeOptions.innerHTML = "";
    if (!dateRecord) {
      timeOptions.innerHTML = `<p class="slot-status">Select a day to see open windows.</p>`;
      return;
    }

    const times = dateRecord.times || [];
    const availableTimes = times.filter((time) => time.available);
    if (!availableTimes.length) {
      timeOptions.innerHTML = `<p class="slot-status error">No open windows on this day.</p>`;
      return;
    }

    availableTimes.forEach(({ time }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot-button";
      button.dataset.time = time;
      button.textContent = time;
      if (form.elements.appointmentTime.value === time) {
        button.classList.add("selected");
      }
      timeOptions.appendChild(button);
    });
  }

  function selectedSlotIsAvailable() {
    const selectedDate = form.elements.appointmentDate.value;
    const selectedTime = form.elements.appointmentTime.value;
    if (!selectedDate || !selectedTime) return false;
    const dateRecord = availabilityData?.dates?.find((date) => date.date === selectedDate);
    return Boolean(dateRecord?.times?.some((time) => time.time === selectedTime && time.available));
  }

  async function refreshAvailabilityBeforeSubmit() {
    availabilityPromise = null;
    availabilityData = await loadAvailability();
    renderDateOptions();
    return selectedSlotIsAvailable();
  }

  function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function selectSlot(target, selector, fieldName, value) {
    quoteRoot.querySelectorAll(selector).forEach((button) => button.classList.remove("selected"));
    target.classList.add("selected");
    form.elements[fieldName].value = value;
    track(`${fieldName}_selected`, { value });
  }

  function renderReview() {
    const data = formData();
    const rows = [
      ["Name", `${data.firstName || ""} ${data.lastName || ""}`.trim()],
      ["Phone", data.phone],
      ["Email", data.email],
      ["ZIP", data.zip],
      ["Dogs", data.dogCount],
      ["Service", data.serviceType],
      ["Address", `${data.street || ""}, ${data.city || ""}, ${data.state || ""}`],
      ["Schedule", data.preferredSchedule],
      ["Appointment", `${data.appointmentDate || ""} at ${data.appointmentTime || ""}`],
      ["Text reminders", data.smsOptIn ? "Text reminders requested" : "Email reminders only"]
    ];

    review.innerHTML = rows
      .filter(([, value]) => value)
      .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("");
  }

  function showStep(index) {
    currentStep = Math.max(0, Math.min(index, panels.length - 1));
    panels.forEach((panel, panelIndex) => {
      panel.classList.toggle("active", panelIndex === currentStep);
    });
    successPanel.hidden = true;
    successPanel.classList.remove("active");
    controls.hidden = false;
    stepCount.textContent = `Step ${currentStep + 1} of ${panels.length}`;
    stepTitle.textContent = stepLabels[currentStep];
    progressBar.style.width = `${((currentStep + 1) / panels.length) * 100}%`;
    prevButton.hidden = currentStep === 0;
    nextButton.hidden = currentStep === panels.length - 1;
    submitButton.hidden = currentStep !== panels.length - 1;

    if (currentStep === 3) renderAppointments({ force: true });
    if (currentStep === 4) renderReview();
    track("step_viewed", { step: stepLabels[currentStep] });
  }

  async function submitPayload(payload) {
    if (!backendUrl) {
      localStorage.setItem("scooperQuotePreviewSubmission", JSON.stringify(payload));
      return { ok: true, mode: "local-preview" };
    }

    return submitPayloadViaFrame(payload);
  }

  function submitPayloadViaFrame(payload) {
    return new Promise((resolve, reject) => {
      const token = `scooperHeroesSubmit${Date.now()}${Math.random().toString(16).slice(2)}`;
      const iframe = document.createElement("iframe");
      const postForm = document.createElement("form");
      const payloadInput = document.createElement("input");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The appointment request timed out. Please try again."));
      }, 25000);

      function cleanup() {
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        iframe.remove();
        postForm.remove();
      }

      function handleMessage(event) {
        const allowedOrigins = new Set([
          "https://script.google.com",
          "https://script.googleusercontent.com"
        ]);
        const data = event.data || {};

        if (!allowedOrigins.has(event.origin)) return;
        if (data.source !== "scooper-heroes-form" || data.token !== token) return;

        cleanup();
        if (data.response?.ok) {
          resolve(data.response);
          return;
        }

        reject(new Error(data.response?.error || "Unable to process this request right now."));
      }

      iframe.name = token;
      iframe.hidden = true;
      iframe.title = "Scooper Heroes form submission";
      postForm.method = "POST";
      postForm.action = `${backendUrl}?type=submit-frame&callbackToken=${encodeURIComponent(token)}`;
      postForm.target = token;
      postForm.style.display = "none";

      payloadInput.type = "hidden";
      payloadInput.name = "payload";
      payloadInput.value = JSON.stringify(payload);

      postForm.appendChild(payloadInput);
      document.body.appendChild(iframe);
      document.body.appendChild(postForm);
      window.addEventListener("message", handleMessage);
      postForm.submit();
    });
  }

  function showSuccess(payload) {
    panels.forEach((panel) => panel.classList.remove("active"));
    successPanel.classList.add("active");
    successPanel.hidden = false;
    controls.hidden = true;
    stepCount.textContent = "Complete";
    stepTitle.textContent = "Request received";
    progressBar.style.width = "100%";
    const body = encodeURIComponent(
      `New quote request:\n\n${JSON.stringify(payload, null, 2)}`
    );
    emailFallback.href = `mailto:scooperheroes.service@gmail.com?subject=Scooper Heroes quote request&body=${body}`;
  }

  form.addEventListener("input", (event) => {
    if (event.target.name === "zip") updateZipResult();
    track("form_interaction", { field: event.target.name });
  });

  dateOptions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button || button.disabled) return;
    const dateRecord = availabilityData?.dates?.find((date) => date.date === button.dataset.date);
    if (!dateRecord) return;
    selectSlot(button, "[data-date]", "appointmentDate", button.dataset.date);
    form.elements.appointmentTime.value = "";
    renderAppointmentTimes(dateRecord);
  });

  timeOptions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-time]");
    if (!button) return;
    selectSlot(button, "[data-time]", "appointmentTime", button.dataset.time);
  });

  nextButton.addEventListener("click", () => {
    if (!validateStep(currentStep)) return;
    showStep(currentStep + 1);
    scrollToForm();
  });

  prevButton.addEventListener("click", () => {
    setMessage("");
    showStep(currentStep - 1);
    scrollToForm();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateStep(currentStep)) return;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    const payload = {
      ...formData(),
      source: "scooper-heroes-custom-form",
      submittedAt: new Date().toISOString(),
      smsReminderStatus: formData().smsOptIn ? "queued_for_future_sms_integration" : "not_requested"
    };

    try {
      const stillAvailable = await refreshAvailabilityBeforeSubmit();
      if (!stillAvailable) {
        setMessage("That appointment window is no longer available. Please choose another time.", "error");
        submitButton.disabled = false;
        submitButton.textContent = "Request Inspection";
        showStep(3);
        scrollToForm();
        return;
      }
      await submitPayload(payload);
      track("form_submitted", { backendConnected: Boolean(backendUrl) });
      showSuccess(payload);
      scrollToForm();
    } catch (error) {
      const errorMessage = error?.message || "Something went wrong sending the request. Please call or text Scooper Heroes.";
      if (/appointment|available|booked|time/i.test(errorMessage)) {
        showStep(3);
        setMessage(errorMessage, "error");
        scrollToForm();
      } else {
        setMessage(errorMessage, "error");
      }
      submitButton.disabled = false;
      submitButton.textContent = "Request Inspection";
    }
  });

  track("form_viewed");
  showStep(0);
}
