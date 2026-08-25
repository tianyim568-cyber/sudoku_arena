const crypto = require('crypto');

/**
 * Generate a username from a display name.
 * Format: "judge." + normalized name parts + "." + 3-char random suffix
 * Example: "John Smith" -> "judge.john.smith.k7m"
 *
 * @param {string} displayName - The judge's display name (e.g., "John Smith")
 * @returns {string} Generated username
 */
function generateUsername(displayName) {
  // Normalize: trim, lowercase, replace non-alphanumeric with dots
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]/g, '.') // Keep alphanumeric + CJK
    .replace(/\.+/g, '.') // Collapse multiple dots
    .replace(/^\./, '') // Remove leading dot
    .replace(/\.$/, ''); // Remove trailing dot

  // Generate 3-char random suffix (lowercase alphanumeric)
  const chars = 'abcdefghijklmnopqrstuvwxyz123456789';
  let suffix = '';
  const bytes = crypto.randomBytes(3);
  for (let i = 0; i < 3; i++) {
    suffix += chars[bytes[i] % chars.length];
  }

  return `judge.${normalized}.${suffix}`;
}

/**
 * Generate a random password.
 * Uses unambiguous charset (no 0/O, 1/l/I confusion).
 *
 * @param {number} length - Password length (default: 10)
 * @returns {string} Generated password
 */
function generatePassword(length = 10) {
  // Unambiguous charset: uppercase (no O, I) + lowercase (no l) + digits (no 0, 1)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

module.exports = { generateUsername, generatePassword };
