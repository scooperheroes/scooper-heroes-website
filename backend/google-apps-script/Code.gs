const CONFIG = {
  spreadsheetId: "PASTE_GOOGLE_SHEET_ID_HERE",
  calendarId: "primary",
  ownerEmail: "scooperheroes.service@gmail.com",
  appointmentDurationMinutes: 45,
  calendarEmailReminderMinutes: 24 * 60,
  calendarPopupReminderMinutes: 2 * 60,
  businessName: "Scooper Heroes",
  timezone: "America/Chicago"
};

function doGet() {
  return jsonResponse({
    ok: true,
    service: "Scooper Heroes Quote Form Backend"
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");

    if (payload.type === "analytics") {
      appendAnalytics(payload);
      return jsonResponse({ ok: true, type: "analytics" });
    }

    const normalized = normalizeSubmission(payload);
    const calendarEvent = createCalendarEvent(normalized);

    appendLead(normalized, calendarEvent);
    sendOwnerEmail(normalized, calendarEvent);
    sendCustomerEmail(normalized, calendarEvent);
    queueSmsReminder(normalized, calendarEvent);

    return jsonResponse({
      ok: true,
      eventId: calendarEvent.getId(),
      smsReminderStatus: normalized.smsReminderStatus
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function normalizeSubmission(payload) {
  const now = new Date();
  const appointmentStart = parseAppointment(payload.appointmentDate, payload.appointmentTime);
  const appointmentEnd = new Date(
    appointmentStart.getTime() + CONFIG.appointmentDurationMinutes * 60 * 1000
  );

  return {
    submittedAt: payload.submittedAt || now.toISOString(),
    firstName: clean(payload.firstName),
    lastName: clean(payload.lastName),
    phone: clean(payload.phone),
    email: clean(payload.email),
    zip: clean(payload.zip),
    dogCount: clean(payload.dogCount),
    serviceType: clean(payload.serviceType),
    street: clean(payload.street),
    city: clean(payload.city),
    state: clean(payload.state),
    lastCleaning: clean(payload.lastCleaning),
    accessNotes: clean(payload.accessNotes),
    preferredSchedule: clean(payload.preferredSchedule),
    specialInstructions: clean(payload.specialInstructions),
    appointmentDate: clean(payload.appointmentDate),
    appointmentTime: clean(payload.appointmentTime),
    appointmentStart,
    appointmentEnd,
    smsOptIn: payload.smsOptIn === "yes",
    smsReminderStatus: payload.smsOptIn === "yes"
      ? "queued_for_future_sms_integration"
      : "not_requested",
    source: clean(payload.source || "scooper-heroes-custom-form")
  };
}

function appendLead(lead, calendarEvent) {
  const sheet = getLeadSheet();
  sheet.appendRow([
    new Date(lead.submittedAt),
    lead.firstName,
    lead.lastName,
    lead.phone,
    lead.email,
    lead.zip,
    lead.dogCount,
    lead.serviceType,
    lead.street,
    lead.city,
    lead.state,
    lead.lastCleaning,
    lead.accessNotes,
    lead.preferredSchedule,
    lead.specialInstructions,
    lead.appointmentDate,
    lead.appointmentTime,
    calendarEvent.getId(),
    lead.smsReminderStatus,
    lead.source
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
  if (!lead.email) return;

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
    lead.phone,
    lead.firstName,
    lead.appointmentStart,
    calendarEvent.getId(),
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
  const sheet = getAnalyticsSheet();
  const detail = payload.detail || {};

  sheet.appendRow([
    new Date(payload.timestamp || new Date().toISOString()),
    clean(payload.event),
    clean(payload.page),
    clean(detail.step),
    clean(detail.zip),
    detail.supported === true ? "yes" : detail.supported === false ? "no" : "",
    JSON.stringify(detail)
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
  if (!dateValue || !timeValue) {
    throw new Error("Missing appointment date or time.");
  }

  const dateParts = dateValue.split("-").map(Number);
  const match = String(timeValue).match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!match) throw new Error("Invalid appointment time.");

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0);
}

function clean(value) {
  return String(value || "").trim();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
