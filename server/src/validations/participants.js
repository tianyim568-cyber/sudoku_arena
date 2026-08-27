const { z } = require('zod');

// Zod schemas for participant import routes.
//
// The upload endpoint receives an Excel file (validated by fileType middleware),
// so there is no JSON body to validate here. The /confirm endpoint, however,
// receives the rows array straight from the client and must be validated:
// even though /upload returns a preview, /confirm can be called directly, and
// the rows could be tampered with. We validate the shape here; the deeper
// per-row validation (required fields, age range, etc.) stays in
// ParticipantImportService.validateRows — that one is called on both /upload
// and /confirm, so we keep a single source of truth for row rules.

// Shape of a single participant row as expected by /confirm.
// `name` and `school` are required non-empty strings; `age` is an optional
// integer in [3, 99]; other fields (province, group, etc.) are passed through
// as strings if present.
const participantRowSchema = z.object({
  name: z.string().min(1).max(100),
  school: z.string().min(1).max(200),
  age: z.union([z.coerce.number().int().min(3).max(99), z.literal('').nullish()]).optional(),
}).passthrough();

// POST /api/competitions/:id/participants/confirm
// Body: { rows: participantRow[] }
// We cap the array length to a reasonable upper bound (1000) to prevent a
// malicious payload from exhausting memory during validation.
const confirmImportSchema = z.object({
  rows: z.array(participantRowSchema).min(1).max(1000),
});

// Shape of a single credential row for the export endpoint.
// The client captures these from the bulkImport response and sends them
// back here to generate the Excel. We re-validate the shape server-side
// because the body is user-controlled: an attacker could craft a payload
// with missing fields or huge strings.
const credentialRowSchema = z.object({
  name: z.string().min(1).max(100),
  school: z.string().max(200).nullable(),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(100),
});

// POST /api/competitions/:id/participants/export
// Body: { credentials: credentialRow[] }
// The array cap matches the confirm cap — an org cannot have more
// participants than that in a single import.
const exportCredentialsSchema = z.object({
  credentials: z.array(credentialRowSchema).min(1).max(1000),
});

module.exports = {
  confirmImportSchema,
  exportCredentialsSchema,
  participantRowSchema,
};
