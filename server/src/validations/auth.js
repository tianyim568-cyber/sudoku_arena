const { z } = require('zod');

// Zod schema for POST /api/auth/login
const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
});

module.exports = { loginSchema };
