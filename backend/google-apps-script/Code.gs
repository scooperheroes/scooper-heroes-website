const CONFIG = {
  spreadsheetId: "PASTE_GOOGLE_SHEET_ID_HERE",
  calendarId: "primary",
  ownerEmail: "scooperheroes.service@gmail.com",
  appointmentDurationMinutes: 120,
  calendarEmailReminderMinutes: 24 * 60,
  calendarPopupReminderMinutes: 2 * 60,
  businessName: "Scooper Heroes",
  timezone: "America/Chicago",
  maxPayloadBytes: 18000,
  minSubmissionSeconds: 6,
  maxFutureAppointmentDays: 45,
  maxAnalyticsPerFiveMinutes: 240,
  maxLeadsPerHour: 30,
  maxLeadsPerContactPerDay: 3
};

const SERVICE_ZIPS = new Set([
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

const ALLOWED_ANALYTICS_EVENTS = new Set([
  "form_viewed",
  "step_viewed",
  "zip_checked",
  "form_submitted",
  "backend_health_check"
]);

const ALLOWED_DOG_COUNTS = new Set(["1", "2", "3", "4", "5", "6+"]);
const ALLOWED_SERVICE_TYPES = new Set(["Recurring service", "One-time cleanup"]);
const ALLOWED_SCHEDULES = new Set(["Weekly", "Biweekly", "Monthly", "One-time only"]);
const ALLOWED_STATES = new Set(["IN", "IL"]);
const WEEKDAY_APPOINTMENT_TIMES = new Set(["9:00 AM", "11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM", "7:00 PM"]);
const SATURDAY_APPOINTMENT_TIMES = new Set(["9:00 AM", "11:00 AM", "1:00 PM", "2:00 PM"]);

function doGet() {
  return jsonResponse({
    ok: true,
    service: "Scooper Heroes Quote Form Backend"
  });
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(8000)) {
      throw new PublicError("The form is busy. Please try again.");
    }

    const payload = parsePayload(event);

    if (payload.type === "analytics") {
      appendAnalytics(payload);
      return jsonResponse({ ok: true, type: "analytics" });
    }

    const normalized = normalizeSubmission(payload);
    enforceLeadRateLimits(normalized);

    const calendarEvent = createCalendarEvent(normalized);
    appendLead(normalized, calendarEvent);
    sendOwnerEmail(normalized, calendarEvent);
    sendCustomerEmail(normalized);
    queueSmsReminder(normalized, calendarEvent);

    return jsonResponse({
      ok: true,
      eventId: calendarEvent.getId(),
      smsReminderStatus: normalized.smsReminderStatus
    });
  } catch (error) {
    const message = error instanceof PublicError
      ? error.message
      : "Unable to process this request right now.";

    recordSecurityEvent(message, event);
    return jsonResponse({ ok: false, error: message });
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // No lock was held.
    }
  }
}

function parsePayload(event) {
  const contents = String(event && event.postData && event.postData.contents || "");

  if (!contents) {
    throw new PublicError("Missing form data.");
  }

  if (contents.length > CONFIG.maxPayloadBytes) {
    throw new PublicError("Form data is too large.");
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new PublicError("Invalid form data.");
  }
}

function normalizeSubmission(payload) {
  if (cleanText(payload.companyWebsite, 200)) {
    throw new PublicError("Unable to process this request.");
  }

  validateSubmissionTiming(payload);

  const appointmentStart = parseAppointment(payload.appointmentDate, payload.appointmentTime);
  const appointmentEnd = new Date(
    appointmentStart.getTime() + CONFIG.appointmentDurationMinutes * 60 * 1000
  );

  const lead = {
    submittedAt: new Date().toISOString(),
    firstName: cleanText(payload.firstName, 60),
    lastName: cleanText(payload.lastName, 80),
    phone: cleanPhone(payload.phone),
    email: cleanEmail(payload.email),
    zip: cleanZip(payload.zip),
    dogCount: cleanText(payload.dogCount, 4),
    serviceType: cleanText(payload.serviceType, 40),
    street: cleanText(payload.street, 140),
    city: cleanText(payload.city, 80),
    state: cleanText(payload.state, 2).toUpperCase(),
    lastCleaning: cleanText(payload.lastCleaning, 80),
    accessNotes: cleanText(payload.accessNotes, 240),
    preferredSchedule: cleanText(payload.preferredSchedule, 40),
    specialInstructions: cleanMultiline(payload.specialInstructions, 600),
    appointmentDate: cleanText(payload.appointmentDate, 10),
    appointmentTime: cleanText(payload.appointmentTime, 12),
    homeForAppointment: payload.homeForAppointment === "yes",
    appointmentStart,
    appointmentEnd,
    smsOptIn: payload.smsOptIn === "yes",
    smsReminderStatus: payload.smsOptIn === "yes"
      ? "queued_for_future_sms_integration"
      : "not_requested",
    source: cleanText(payload.source || "scooper-heroes-custom-form", 80),
    formNonce: cleanText(payload.formNonce, 80)
  };

  validateRequiredFields(lead);
  validateAllowedValues(lead);

  return lead;
}

function validateSubmissionTiming(payload) {
  const startedAt = Number(payload.formStartedAt || 0);

  if (!startedAt) return;

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  if (elapsedSeconds >= 0 && elapsedSeconds < CONFIG.minSubmissionSeconds) {
    throw new PublicError("Unable to process this request.");
  }
}

function validateRequiredFields(lead) {
  const required = [
    "firstName",
    "lastName",
    "phone",
    "email",
    "zip",
    "dogCount",
    "serviceType",
    "street",
    "city",
    "state",
    "lastCleaning",
    "preferredSchedule",
    "appointmentDate",
    "appointmentTime",
    "homeForAppointment"
  ];

  required.forEach((field) => {
    if (!lead[field]) {
      throw new PublicError("Missing required form fields.");
    }
  });
}

function validateAllowedValues(lead) {
  if (!SERVICE_ZIPS.has(lead.zip)) {
    throw new PublicError("ZIP code is outside the current service area.");
  }

  if (!ALLOWED_DOG_COUNTS.has(lead.dogCount)) {
    throw new PublicError("Invalid dog count.");
  }

  if (!ALLOWED_SERVICE_TYPES.has(lead.serviceType)) {
    throw new PublicError("Invalid service type.");
  }

  if (!ALLOWED_SCHEDULES.has(lead.preferredSchedule)) {
    throw new PublicError("Invalid schedule.");
  }

  if (!ALLOWED_STATES.has(lead.state)) {
    throw new PublicError("Invalid state.");
  }

  const appointmentDay = lead.appointmentStart.getDay();
  const validAppointmentTime = appointmentDay === 6
    ? SATURDAY_APPOINTMENT_TIMES.has(lead.appointmentTime)
    : WEEKDAY_APPOINTMENT_TIMES.has(lead.appointmentTime);

  if (!validAppointmentTime) {
    throw new PublicError("Invalid appointment time.");
  }

  if (!lead.homeForAppointment) {
    throw new PublicError("Customer must be home for the appointment.");
  }

  if (!isValidEmail(lead.email)) {
    throw new PublicError("Invalid email address.");
  }

  if (!isValidPhone(lead.phone)) {
    throw new PublicError("Invalid phone number.");
  }
}

function enforceLeadRateLimits(lead) {
  consumeRateLimit("lead:global", CONFIG.maxLeadsPerHour, 60 * 60);
  consumeRateLimit(`lead:email:${hashKey(lead.email)}`, CONFIG.maxLeadsPerContactPerDay, 24 * 60 * 60);
  consumeRateLimit(`lead:phone:${hashKey(lead.phone)}`, CONFIG.maxLeadsPerContactPerDay, 24 * 60 * 60);
}

function appendLead(lead, calendarEvent) {
  const sheet = getLeadSheet();
  sheet.appendRow([
    new Date(lead.submittedAt),
    safeCell(lead.firstName),
    safeCell(lead.lastName),
    safeCell(lead.phone),
    safeCell(lead.email),
    safeCell(lead.zip),
    safeCell(lead.dogCount),
    safeCell(lead.serviceType),
    safeCell(lead.street),
    safeCell(lead.city),
    safeCell(lead.state),
    safeCell(lead.lastCleaning),
    safeCell(lead.accessNotes),
    safeCell(lead.preferredSchedule),
    safeCell(lead.specialInstructions),
    safeCell(lead.appointmentDate),
    safeCell(lead.appointmentTime),
    safeCell(calendarEvent.getId()),
    safeCell(lead.smsReminderStatus),
    safeCell(lead.source),
    lead.homeForAppointment ? "Yes" : "No"
  ]);
}

function createCalendarEvent(lead) {
  const calendar = CalendarApp.getCalendarById(CONFIG.calendarId);
  const title = `Yard Inspection - ${lead.firstName} ${lead.lastName}`;
  const location = `${lead.street}, ${lead.city}, ${lead.state} ${lead.zip}`;
  const description = [
    `${CONFIG.businessName} free yard inspection`,
    "",
    `Customer: ${lead.firstName} ${lead.lastName}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Dogs: ${lead.dogCount}`,
    `Service type: ${lead.serviceType}`,
    `Preferred schedule: ${lead.preferredSchedule}`,
    `Last cleaning: ${lead.lastCleaning}`,
    `Access notes: ${lead.accessNotes}`,
    `Special instructions: ${lead.specialInstructions}`,
    `SMS reminder status: ${lead.smsReminderStatus}`
  ].join("\n");

  const event = calendar.createEvent(title, lead.appointmentStart, lead.appointmentEnd, {
    location,
    description,
    guests: lead.email,
    sendInvites: true
  });

  event.addEmailReminder(CONFIG.calendarEmailReminderMinutes);
  event.addPopupReminder(CONFIG.calendarPopupReminderMinutes);

  return event;
}

function sendOwnerEmail(lead, calendarEvent) {
  const subject = `New Scooper Heroes quote request: ${lead.firstName} ${lead.lastName}`;
  const body = [
    "A new quote request was submitted.",
    "",
    `Name: ${lead.firstName} ${lead.lastName}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Address: ${lead.street}, ${lead.city}, ${lead.state} ${lead.zip}`,
    `Dogs: ${lead.dogCount}`,
    `Service type: ${lead.serviceType}`,
    `Preferred schedule: ${lead.preferredSchedule}`,
    `Appointment: ${lead.appointmentDate} at ${lead.appointmentTime}`,
    `Customer will be home: ${lead.homeForAppointment ? "Yes" : "No"}`,
    `Calendar event: ${calendarEvent.getId()}`,
    "",
    `Access notes: ${lead.accessNotes}`,
    `Special instructions: ${lead.specialInstructions}`,
    "",
    `SMS reminder status: ${lead.smsReminderStatus}`
  ].join("\n");

  MailApp.sendEmail(CONFIG.ownerEmail, subject, body);
}

function sendCustomerEmail(lead) {
  const subject = "Your Scooper Heroes yard inspection request";
  const body = [
    `Hi ${lead.firstName},`,
    "",
    "Thanks for requesting a free Scooper Heroes yard inspection.",
    "",
    `Requested appointment: ${lead.appointmentDate} at ${lead.appointmentTime}`,
    `Service address: ${lead.street}, ${lead.city}, ${lead.state} ${lead.zip}`,
    "",
    "We will confirm your quote details and reach out if anything needs to be adjusted.",
    "",
    "Scooper Heroes",
    "(708) 739-4317",
    "scooperheroes.service@gmail.com"
  ].join("\n");

  MailApp.sendEmail(lead.email, subject, body);
}

function queueSmsReminder(lead, calendarEvent) {
  if (!lead.smsOptIn) return;

  const sheet = getSmsQueueSheet();
  sheet.appendRow([
    new Date(),
    safeCell(lead.phone),
    safeCell(lead.firstName),
    lead.appointmentStart,
    safeCell(calendarEvent.getId()),
    "pending_future_sms_provider",
    "Twilio or another SMS provider will send this later."
  ]);
}

function getLeadSheet() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName("Leads") || spreadsheet.insertSheet("Leads");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Submitted At",
      "First Name",
      "Last Name",
      "Phone",
      "Email",
      "ZIP",
      "Dog Count",
      "Service Type",
      "Street",
      "City",
      "State",
      "Last Cleaning",
      "Access Notes",
      "Preferred Schedule",
      "Special Instructions",
      "Appointment Date",
      "Appointment Time",
      "Calendar Event ID",
      "SMS Reminder Status",
      "Source",
      "Customer Will Be Home"
    ]);
  }

  return sheet;
}

function getSmsQueueSheet() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName("SMS Queue") || spreadsheet.insertSheet("SMS Queue");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Queued At",
      "Phone",
      "First Name",
      "Appointment Start",
      "Calendar Event ID",
      "Status",
      "Notes"
    ]);
  }

  return sheet;
}

function appendAnalytics(payload) {
  consumeRateLimit("analytics:global", CONFIG.maxAnalyticsPerFiveMinutes, 5 * 60);

  const eventName = cleanText(payload.event, 60);
  if (!ALLOWED_ANALYTICS_EVENTS.has(eventName)) {
    throw new PublicError("Invalid analytics event.");
  }

  const sheet = getAnalyticsSheet();
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : {};
  const zip = cleanZip(detail.zip);

  sheet.appendRow([
    parseAnalyticsDate(payload.timestamp),
    safeCell(eventName),
    safeCell(cleanText(payload.page, 40)),
    safeCell(cleanText(detail.step, 60)),
    safeCell(zip),
    detail.supported === true ? "yes" : detail.supported === false ? "no" : "",
    safeCell(JSON.stringify(limitDetail(detail)))
  ]);
}

function getAnalyticsSheet() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName("Analytics") || spreadsheet.insertSheet("Analytics");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Event Time",
      "Event",
      "Page",
      "Step",
      "ZIP",
      "ZIP Supported",
      "Details"
    ]);
  }

  return sheet;
}

function parseAppointment(dateValue, timeValue) {
  const date = cleanText(dateValue, 10);
  const time = cleanText(timeValue, 12);
  const dateParts = date.split("-").map(Number);
  const match = time.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);

  if (dateParts.length !== 3 || dateParts.some((part) => !Number.isFinite(part))) {
    throw new PublicError("Invalid appointment date.");
  }

  if (!match) {
    throw new PublicError("Invalid appointment time.");
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  const appointment = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0);
  const now = new Date();
  const maxDate = new Date(now.getTime() + CONFIG.maxFutureAppointmentDays * 24 * 60 * 60 * 1000);

  if (Number.isNaN(appointment.getTime())) {
    throw new PublicError("Invalid appointment date.");
  }

  if (appointment.getDay() === 0) {
    throw new PublicError("Appointment must be Monday through Saturday.");
  }

  if (appointment.getTime() <= now.getTime() || appointment.getTime() > maxDate.getTime()) {
    throw new PublicError("Appointment is outside the allowed booking window.");
  }

  return appointment;
}

function parseAnalyticsDate(value) {
  const parsed = new Date(cleanText(value, 40) || new Date().toISOString());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength || 200);
}

function cleanMultiline(value, maxLength) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength || 600);
}

function cleanZip(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 15);
  return digits.length === 11 && digits.charAt(0) === "1" ? digits.slice(1) : digits;
}

function cleanEmail(value) {
  return cleanText(value, 160).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
  return /^\d{10,15}$/.test(value);
}

function safeCell(value) {
  const text = String(value || "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function limitDetail(detail) {
  const allowed = {};
  Object.keys(detail).slice(0, 12).forEach((key) => {
    allowed[cleanText(key, 40)] = cleanText(detail[key], 200);
  });
  return allowed;
}

function consumeRateLimit(key, limit, seconds) {
  const cache = CacheService.getScriptCache();
  const current = Number(cache.get(key) || "0");

  if (current >= limit) {
    throw new PublicError("Too many requests. Please try again later.");
  }

  cache.put(key, String(current + 1), seconds);
}

function hashKey(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || "").toLowerCase(),
    Utilities.Charset.UTF_8
  );

  return digest
    .map((byte) => (byte + 256).toString(16).slice(-2))
    .join("")
    .slice(0, 24);
}

function recordSecurityEvent(message, event) {
  try {
    consumeRateLimit("security-log:global", 60, 60 * 60);

    const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = spreadsheet.getSheetByName("Security Events") || spreadsheet.insertSheet("Security Events");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Time", "Reason", "Payload Length"]);
    }

    const length = String(event && event.postData && event.postData.contents || "").length;
    sheet.appendRow([new Date(), safeCell(message), length]);
  } catch (error) {
    // Avoid turning logging problems into customer-facing form problems.
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

class PublicError extends Error {}
