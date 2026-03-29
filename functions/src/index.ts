/**
 * Cloud Functions for this project are implemented in `../index.js` (CommonJS, Firebase entry).
 *
 * Callable exports relevant to admin auth:
 * - `setAdminRole` — requires existing caller `auth.token.admin === true`
 * - `bootstrapInitialAdmin` — one-time secret gate; see `../index.js` and `../scripts/setInitialAdmin.js`
 */

export {};
