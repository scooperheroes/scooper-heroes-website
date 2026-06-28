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
  maxLeadsPerContactPerDay: 3,
  siteUrl: "https://scooper-heroes.com/",
  siteOrigin: "https://scooper-heroes.com",
  logoUrl: "https://scooper-heroes.com/assets/logo-scooper-heroes.png",
  checkAllOwnedCalendarsForAvailability: true
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

function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};

  if (params.type === "availability") {
    const payload = getAvailabilityPayload();
    if (params.callback) {
      return javascriptResponse(payload, params.callback);
    }
    return jsonResponse(payload);
  }

  return jsonResponse({
    ok: true,
    service: "Scooper Heroes Quote Form Backend"
  });
}

function doPost(event) {
  const params = event && event.parameter ? event.parameter : {};
  const isFrameSubmit = params.type === "submit-frame";
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

    const response = {
      ok: true,
      eventId: calendarEvent.getId(),
      smsReminderStatus: normalized.smsReminderStatus
    };

    return isFrameSubmit
      ? frameResponse(response, params.callbackToken)
      : jsonResponse(response);
  } catch (error) {
    const message = error instanceof PublicError
      ? error.message
      : "Unable to process this request right now.";

    recordSecurityEvent(message, event);
    const response = { ok: false, error: message };
    return isFrameSubmit
      ? frameResponse(response, params.callbackToken)
      : jsonResponse(response);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // No lock was held.
    }
  }
}

function parsePayload(event) {
  const parameterPayload = event && event.parameter && event.parameter.payload;
  if (parameterPayload) {
    return parseJsonPayload(parameterPayload);
  }

  const contents = String(event && event.postData && event.postData.contents || "");

  if (!contents) {
    throw new PublicError("Missing form data.");
  }

  if (contents.length > CONFIG.maxPayloadBytes) {
    throw new PublicError("Form data is too large.");
  }

  const formPayload = contents.match(/(?:^|[\r\n&])payload=([\s\S]*)/);
  if (formPayload) {
    return parseJsonPayload(decodeURIComponent(formPayload[1].replace(/\+/g, " ")));
  }

  return parseJsonPayload(contents);
}

function parseJsonPayload(contents) {
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
    "appointmentTime"
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

  if (!isAppointmentSlotAvailable(lead.appointmentStart, lead.appointmentEnd)) {
    throw new PublicError("That appointment time is no longer available. Please choose another time.");
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
    safeCell(lead.source)
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
  const appointmentWindow = formatAppointmentWindow(lead);
  const serviceAddress = `${lead.street}, ${lead.city}, ${lead.state} ${lead.zip}`;
  const body = [
    `Hi ${lead.firstName},`,
    "",
    "Thanks for requesting a free Scooper Heroes yard inspection. We received your request and will review the details before your visit.",
    "",
    `Requested appointment: ${appointmentWindow}`,
    `Service address: ${serviceAddress}`,
    `Dogs: ${lead.dogCount}`,
    `Service requested: ${lead.serviceType}`,
    "",
    "If anything needs to be adjusted, our team will reach out before your inspection.",
    "",
    "Saving Your Yard One Scoop At A Time!",
    "Scooper Heroes Support Team",
    CONFIG.ownerEmail,
    "708-739-4317",
    CONFIG.siteUrl,
    "",
    "________________________________",
    "",
    "The information contained in this e-mail and any accompanying documents is intended for the sole use of the recipient to whom it is addressed, and may contain information that is privileged, confidential, and prohibited from disclosure under applicable law. If you are not the intended recipient, or authorized to receive this on behalf of the recipient, you are hereby notified that any review, use, disclosure, copying, or distribution is prohibited. If you are not the intended recipient(s), please contact the sender by e-mail and destroy all copies of the original message. Thank you."
  ].join("\n");
  const htmlBody = buildCustomerEmailHtml(lead, appointmentWindow, serviceAddress);

  MailApp.sendEmail(lead.email, subject, body, {
    htmlBody,
    name: "Scooper Heroes",
    replyTo: CONFIG.ownerEmail
  });
}

function buildCustomerEmailHtml(lead, appointmentWindow, serviceAddress) {
  const safeFirstName = escapeHtml(lead.firstName);
  const safeAppointmentWindow = escapeHtml(appointmentWindow);
  const safeServiceAddress = escapeHtml(serviceAddress);
  const safeDogCount = escapeHtml(lead.dogCount);
  const safeServiceType = escapeHtml(lead.serviceType);
  const safeSiteUrl = escapeHtml(CONFIG.siteUrl);
  const safeLogoUrl = escapeHtml(CONFIG.logoUrl);
  const safeOwnerEmail = escapeHtml(CONFIG.ownerEmail);

  return `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f8f8; font-family:Arial, Helvetica, sans-serif; color:#111633;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f8; padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; background:#ffffff; border-radius:18px; overflow:hidden; border:1px solid #dbe8e6;">
            <tr>
              <td style="background:#111633; padding:28px 28px 24px; text-align:center;">
                <img src="${safeLogoUrl}" width="142" alt="Scooper Heroes" style="display:block; margin:0 auto 18px; width:142px; max-width:46%; height:auto;">
                <p style="margin:0 0 8px; color:#34dec9; font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase;">Free Yard Inspection</p>
                <h1 style="margin:0; color:#ffffff; font-size:30px; line-height:1.15; font-weight:900;">Your request is confirmed.</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 10px;">
                <p style="margin:0 0 18px; font-size:18px; line-height:1.55;">Hi ${safeFirstName},</p>
                <p style="margin:0 0 22px; font-size:16px; line-height:1.65; color:#45516a;">
                  Thanks for requesting a free Scooper Heroes yard inspection. We received your request and will review the details before your visit.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate; border-spacing:0; background:#eefdf9; border:1px solid #a9eee5; border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 6px; color:#cc1f1f; font-size:12px; font-weight:900; letter-spacing:1.6px; text-transform:uppercase;">Appointment Window</p>
                      <p style="margin:0; color:#111633; font-size:22px; line-height:1.25; font-weight:900;">${safeAppointmentWindow}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:16px 0; border-bottom:1px solid #e4eceb;">
                      <p style="margin:0 0 4px; color:#6b7488; font-size:12px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase;">Service Address</p>
                      <p style="margin:0; color:#111633; font-size:16px; line-height:1.5; font-weight:700;">${safeServiceAddress}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0; border-bottom:1px solid #e4eceb;">
                      <p style="margin:0 0 4px; color:#6b7488; font-size:12px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase;">Dogs</p>
                      <p style="margin:0; color:#111633; font-size:16px; line-height:1.5; font-weight:700;">${safeDogCount}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 0;">
                      <p style="margin:0 0 4px; color:#6b7488; font-size:12px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase;">Service Requested</p>
                      <p style="margin:0; color:#111633; font-size:16px; line-height:1.5; font-weight:700;">${safeServiceType}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 26px;">
                <div style="background:#fff7f2; border-left:5px solid #ff3c38; border-radius:10px; padding:16px 18px;">
                  <p style="margin:0; color:#45516a; font-size:15px; line-height:1.6;">
                    If anything needs to be adjusted, our team will reach out before your inspection.
                  </p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#111633; padding:24px 28px; color:#ffffff;">
                <p style="margin:0 0 8px; color:#34dec9; font-size:15px; font-weight:900;">Saving Your Yard One Scoop At A Time!</p>
                <p style="margin:0 0 4px; font-size:15px; line-height:1.55;">Scooper Heroes Support Team</p>
                <p style="margin:0; font-size:15px; line-height:1.55;">
                  <a href="mailto:${safeOwnerEmail}" style="color:#ffffff; text-decoration:underline;">${safeOwnerEmail}</a><br>
                  <a href="tel:17087394317" style="color:#ffffff; text-decoration:underline;">708-739-4317</a><br>
                  <a href="${safeSiteUrl}" style="color:#ffffff; text-decoration:underline;">Scooper-Heroes.com</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px; background:#f7faf9;">
                <p style="margin:0; color:#687386; font-size:11px; line-height:1.55;">
                  The information contained in this e-mail and any accompanying documents is intended for the sole use of the recipient to whom it is addressed, and may contain information that is privileged, confidential, and prohibited from disclosure under applicable law. If you are not the intended recipient, or authorized to receive this on behalf of the recipient, you are hereby notified that any review, use, disclosure, copying, or distribution is prohibited. If you are not the intended recipient(s), please contact the sender by e-mail and destroy all copies of the original message. Thank you.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function formatAppointmentWindow(lead) {
  const date = Utilities.formatDate(lead.appointmentStart, CONFIG.timezone, "EEEE, MMMM d, yyyy");
  const start = Utilities.formatDate(lead.appointmentStart, CONFIG.timezone, "h:mm a");
  const end = Utilities.formatDate(lead.appointmentEnd, CONFIG.timezone, "h:mm a");
  return `${date}, ${start} - ${end}`;
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
      "Source"
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

function getAvailabilityPayload() {
  const dates = [];
  const blackoutDates = getBlackoutDates();
  let offset = 1;

  while (dates.length < 7 && offset <= CONFIG.maxFutureAppointmentDays) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);

    if (date.getDay() !== 0) {
      const iso = localIsoDate(date);
      const isBlackout = blackoutDates.has(iso);
      const availableTimes = getAppointmentTimesForDay(date.getDay()).map((time) => {
        const start = parseAppointment(iso, time);
        const end = new Date(start.getTime() + CONFIG.appointmentDurationMinutes * 60 * 1000);
        return {
          time,
          available: !isBlackout && isAppointmentSlotAvailable(start, end, blackoutDates)
        };
      });

      dates.push({
        date: iso,
        label: Utilities.formatDate(date, CONFIG.timezone, "EEE, MMM d"),
        day: date.getDay(),
        blackout: isBlackout,
        times: availableTimes
      });
    }

    offset += 1;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    durationMinutes: CONFIG.appointmentDurationMinutes,
    dates
  };
}

function getAppointmentTimesForDay(day) {
  return Array.from(day === 6 ? SATURDAY_APPOINTMENT_TIMES : WEEKDAY_APPOINTMENT_TIMES);
}

function isAppointmentSlotAvailable(start, end, blackoutDates) {
  const blackouts = blackoutDates || getBlackoutDates();
  if (blackouts.has(localIsoDate(start))) {
    return false;
  }

  const calendars = getCalendarsForAvailability();

  return calendars.every((calendar) => {
    const events = calendar.getEvents(start, end);
    return events.every((event) => {
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();
      return eventEnd.getTime() <= start.getTime() || eventStart.getTime() >= end.getTime();
    });
  });
}

function getCalendarsForAvailability() {
  const calendars = [];
  const seen = new Set();

  function addCalendar(calendar) {
    if (!calendar) return;
    const id = calendar.getId();
    if (seen.has(id)) return;
    seen.add(id);
    calendars.push(calendar);
  }

  addCalendar(CalendarApp.getCalendarById(CONFIG.calendarId));

  if (CONFIG.checkAllOwnedCalendarsForAvailability) {
    CalendarApp.getAllOwnedCalendars().forEach(addCalendar);
  }

  return calendars;
}

function getBlackoutDates() {
  const dates = new Set();

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = spreadsheet.getSheetByName("Blackout Dates");
    if (!sheet || sheet.getLastRow() < 2) return dates;

    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    values.forEach(([value]) => {
      const iso = normalizeBlackoutDate(value);
      if (iso) dates.add(iso);
    });
  } catch (error) {
    // If the sheet is unavailable, Calendar conflicts still protect bookings.
  }

  return dates;
}

function normalizeBlackoutDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localIsoDate(value);
  }

  const text = cleanText(value, 24);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? text : "";
}

function localIsoDate(date) {
  return Utilities.formatDate(date, CONFIG.timezone, "yyyy-MM-dd");
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function frameResponse(data, callbackToken) {
  const message = {
    source: "scooper-heroes-form",
    token: cleanText(callbackToken, 120),
    response: data
  };
  const safeMessage = JSON.stringify(message).replace(/</g, "\\u003c");
  const safeOrigin = JSON.stringify(CONFIG.siteOrigin);

  return HtmlService.createHtmlOutput(`
<!doctype html>
<html>
  <body>
    <script>
      window.parent.postMessage(${safeMessage}, ${safeOrigin});
    </script>
  </body>
</html>`);
}

function javascriptResponse(data, callback) {
  const callbackName = cleanCallbackName(callback);
  return ContentService
    .createTextOutput(`${callbackName}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function cleanCallbackName(value) {
  const text = String(value || "");
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    return text;
  }
  return "scooperHeroesAvailability";
}

class PublicError extends Error {}
