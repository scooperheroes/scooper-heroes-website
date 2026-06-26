# Scooper Heroes Quote Form Backend

This is the Google Apps Script backend scaffold for the custom quote form.
The live website points to a deployed copy in Google Apps Script. This repo
copy keeps the Sheet ID as a placeholder so private Google account details are
not published.

## What It Handles

- Receives the custom website form submission
- Saves the lead into a Google Sheet
- Creates a Google Calendar event
- Sends Scooper Heroes an email notification
- Sends the customer an email confirmation
- Tracks form views, step views, ZIP checks, and submissions in an `Analytics` sheet
- Adds future SMS opt-ins to an `SMS Queue` sheet for a later Twilio/text-message integration

## Setup

1. Create a Google Sheet for quote requests.
2. Copy the Sheet ID from the URL.
3. Create a new Google Apps Script project.
4. Paste `Code.gs` into the project.
5. Replace `PASTE_GOOGLE_SHEET_ID_HERE` with the Sheet ID.
6. Deploy as a web app.
7. Copy the web app URL.
8. Add this before `quote-form.js` on the website:

```html
<script>
  window.SCOOPER_HEROES_FORM_ENDPOINT = "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";
</script>
```

If the endpoint is ever removed from `quote.html`, the form saves submissions
only in the browser and creates an email fallback.

## Future SMS Integration

Text reminders should be connected through a provider such as Twilio. This
scaffold already stores customers who opt in inside the `SMS Queue` sheet, so
the next phase can process those rows and send reminder messages.
