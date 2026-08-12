/**
 * validate.js — Zod-based request body validation middleware factory.
 *
 * Creates Express middleware from a Zod schema. On validation failure,
 * returns a 400 response with the first error message.
 *
 * Usage:
 *   const { z } = require('zod');
 *   const { validate } = require('../middleware/validate');
 *
 *   const loginSchema = z.object({
 *     username: z.string().min(1),
 *     password: z.string().min(1),
 *   });
 *
 *   router.post('/login', validate(loginSchema), handler);
 */

const { z } = require('zod');

/**
 * Validate req.body against a Zod schema.
 * @param {z.ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Zod v4 error structure: result.error.errors is an array
      const firstError = result.error.issues?.[0]?.message ||
                         result.error.errors?.[0]?.message ||
                         'Validation failed';
      return res.json({ code: 40001, message: firstError, data: null });
    }
    // Replace req.body with the parsed (and possibly transformed) data
    req.body = result.data;
    next();
  };
}

/**
 * Validate req.query against a Zod schema.
 * @param {z.ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstError = result.error.issues?.[0]?.message ||
                         result.error.errors?.[0]?.message ||
                         'Query validation failed';
      return res.json({ code: 40001, message: firstError, data: null });
    }
    req.query = result.data;
    next();
  };
}

module.exports = { validateBody, validateQuery, z };
