import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDENTIALS_MESSAGE,
  credentialsKnownMissing,
  isCredentialFailure,
  noteCredentialFailure,
  resetCredentialFailure,
} from './configError.ts';

/**
 * The shapes this condition actually arrives in, from three different layers.
 * Guessing at them is how the last two "requires an index" guards were written
 * wrong, so these are the literal strings the SDKs produce.
 */

test('recognises the error google-auth-library throws directly', () => {
  assert.equal(
    isCredentialFailure(
      new Error(
        'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.'
      )
    ),
    true
  );
});

test('recognises a missing project id', () => {
  assert.equal(isCredentialFailure(new Error('Unable to detect a Project Id in the current environment.')), true);
  assert.equal(isCredentialFailure(new Error('Failed to determine project ID.')), true);
});

test('recognises a service-account key the project has rejected', () => {
  assert.equal(isCredentialFailure({ message: 'Error fetching access token: invalid_grant' }), true);
  assert.equal(isCredentialFailure({ errorInfo: { code: 'app/invalid-credential' } }), true);
});

test('an UNAUTHENTICATED status counts only when the text agrees', () => {
  assert.equal(
    isCredentialFailure({ code: 16, message: 'UNAUTHENTICATED: Failed to obtain access token' }),
    true
  );
  // A revoked user token is also 16, and is a different problem with a
  // different fix. Sending that to the service-account page would be worse
  // than the generic message.
  assert.equal(isCredentialFailure({ code: 16, message: 'The user token has been revoked.' }), false);
});

test('leaves every other failure alone', () => {
  const others = [
    { code: 7, message: 'Missing or insufficient permissions.' },
    { code: 8, message: 'RESOURCE_EXHAUSTED: Quota exceeded.' },
    { code: 9, message: 'The query requires a COLLECTION_GROUP_ASC index.' },
    { code: 14, message: 'UNAVAILABLE' },
    new Error('That lead no longer exists.'),
  ];
  for (const error of others) {
    assert.equal(isCredentialFailure(error), false, JSON.stringify(error));
  }
});

test('survives the shapes an error is not', () => {
  for (const value of [null, undefined, '', 0, {}, [], 'a string']) {
    assert.equal(isCredentialFailure(value), false, JSON.stringify(value));
  }
});

test('the message names both the variables and where the key comes from', () => {
  assert.match(CREDENTIALS_MESSAGE, /FIREBASE_CLIENT_EMAIL/);
  assert.match(CREDENTIALS_MESSAGE, /FIREBASE_PRIVATE_KEY/);
  assert.match(CREDENTIALS_MESSAGE, /Service accounts/);
  // The half that stops people hunting for a bug in one screen.
  assert.match(CREDENTIALS_MESSAGE, /browser/i);
});

test('once seen it is remembered, so the next call does not re-discover it', () => {
  resetCredentialFailure();
  assert.equal(credentialsKnownMissing(), false);

  noteCredentialFailure();
  assert.equal(credentialsKnownMissing(), true);

  resetCredentialFailure();
  assert.equal(credentialsKnownMissing(), false);
});
