// Validation middleware factory.
// Checks req.body against a Zod schema before the route handler runs.
// On failure, responds with the app's standard error envelope (HTTP 200 + code);
// on success, the request continues to the handler.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Invalid request data';
      return res.json({ code: 40001, message, data: null });
    }
    next();
  };
}

module.exports = { validate };
