import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedGoogleEmail } from '../src/domain/googleLogin.js';

test('Google login accepts only a verified allowlisted email', () => {
  const allowed = ['owner@example.com'];
  assert.equal(
    allowedGoogleEmail({ email: ' Owner@Example.com ', email_verified: true }, allowed),
    'owner@example.com'
  );
  assert.equal(allowedGoogleEmail({ email: 'other@example.com', email_verified: true }, allowed), '');
  assert.equal(allowedGoogleEmail({ email: 'owner@example.com', email_verified: false }, allowed), '');
  assert.equal(allowedGoogleEmail({}, allowed), '');
});
