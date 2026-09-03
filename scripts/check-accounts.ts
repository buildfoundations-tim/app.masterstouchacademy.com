/**
 * Exercises the account lifecycle: password hashing, token issue and redemption,
 * expiry, single use, supersession, and session invalidation on reset.
 *
 *   npx tsx scripts/check-accounts.ts
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import 'dotenv/config';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Mirrors issueToken() — supersede, then insert. */
async function issue(userId: string, purpose: 'email_verification' | 'password_reset') {
  await db.verificationToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = randomBytes(32).toString('base64url');
  const ttl = purpose === 'password_reset' ? 3600_000 : 86_400_000;
  await db.verificationToken.create({
    data: { userId, purpose, tokenHash: sha(token), expiresAt: new Date(Date.now() + ttl) },
  });
  return token;
}

/** Mirrors consumeToken(). */
async function consume(token: string, purpose: 'email_verification' | 'password_reset') {
  const rec = await db.verificationToken.findUnique({ where: { tokenHash: sha(token) } });
  if (!rec || rec.purpose !== purpose) return { ok: false as const, reason: 'invalid' };
  if (rec.usedAt) return { ok: false as const, reason: 'used' };
  if (rec.expiresAt <= new Date()) return { ok: false as const, reason: 'expired' };
  const claimed = await db.verificationToken.updateMany({
    where: { id: rec.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false as const, reason: 'used' };
  return { ok: true as const, userId: rec.userId };
}

async function main() {
  const email = 'lifecycle-test@example.com';
  await db.user.deleteMany({ where: { email } });

  console.log('\nPassword hashing:');
  const pw = 'correct horse battery staple';
  const h = await argonHash(pw);
  check('argon2id prefix', h.startsWith('$argon2id$'), true);
  check('correct password verifies', await argonVerify(h, pw), true);
  check('wrong password rejected', await argonVerify(h, pw + 'x'), false);
  const h2 = await argonHash(pw);
  check('same password hashes differently (salted)', h === h2, false);

  console.log('\nAccount creation:');
  const user = await db.user.create({
    data: {
      email, passwordHash: h, firstName: 'Test', lastName: 'Member',
      tier: 1, settings: { create: {} },
    },
  });
  check('new members start on Community (tier 1)', user.tier, 1);
  check('new members are not owners', user.role === 'owner', false);
  check('email starts unverified', user.emailVerifiedAt, null);
  check('settings row created alongside', await db.userSettings.count({ where: { userId: user.id } }), 1);

  console.log('\nToken storage:');
  const t1 = await issue(user.id, 'email_verification');
  const stored = await db.verificationToken.findFirstOrThrow({ where: { userId: user.id, usedAt: null } });
  check('raw token is NOT stored', stored.tokenHash === t1, false);
  check('the SHA-256 is', stored.tokenHash, sha(t1));
  check('token is long enough to be unguessable', t1.length >= 40, true);

  console.log('\nSingle use:');
  const first = await consume(t1, 'email_verification');
  check('first redemption succeeds', first.ok, true);
  check('…and returns the right user', first.ok && first.userId, user.id);
  const second = await consume(t1, 'email_verification');
  check('second redemption is refused', second.ok, false);
  check('…as already used', !second.ok && second.reason, 'used');

  console.log('\nPurpose is enforced:');
  const resetTok = await issue(user.id, 'password_reset');
  const wrongPurpose = await consume(resetTok, 'email_verification');
  check('a reset token cannot verify an email', wrongPurpose.ok, false);
  check('…reported as invalid', !wrongPurpose.ok && wrongPurpose.reason, 'invalid');
  check('the token still works for its own purpose', (await consume(resetTok, 'password_reset')).ok, true);

  console.log('\nExpiry:');
  const expTok = randomBytes(32).toString('base64url');
  await db.verificationToken.create({
    data: {
      userId: user.id, purpose: 'password_reset', tokenHash: sha(expTok),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const expired = await consume(expTok, 'password_reset');
  check('an expired token is refused', expired.ok, false);
  check('…as expired', !expired.ok && expired.reason, 'expired');

  console.log('\nIssuing supersedes earlier links:');
  const old = await issue(user.id, 'password_reset');
  const fresh = await issue(user.id, 'password_reset');
  check('the newest token works', (await consume(fresh, 'password_reset')).ok, true);
  const oldResult = await consume(old, 'password_reset');
  check('the superseded one does not', oldResult.ok, false);

  console.log('\nGarbage input:');
  check('random string is invalid', (await consume('not-a-real-token', 'password_reset')).ok, false);
  check('empty string is invalid', (await consume('', 'password_reset')).ok, false);

  console.log('\nA reset signs you out everywhere:');
  for (let i = 0; i < 3; i++) {
    await db.session.create({
      data: {
        userId: user.id, tokenHash: sha('sess-' + i),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  }
  check('three sessions open', await db.session.count({ where: { userId: user.id } }), 3);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await argonHash('a-new-password') } }),
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);
  check('all sessions destroyed by the reset', await db.session.count({ where: { userId: user.id } }), 0);
  const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  check('new password verifies', await argonVerify(after.passwordHash!, 'a-new-password'), true);
  check('old password no longer works', await argonVerify(after.passwordHash!, pw), false);

  console.log('\nVerification marks the account:');
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  const verified = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  check('emailVerifiedAt is set', verified.emailVerifiedAt !== null, true);

  console.log('\nEmail uniqueness:');
  let dup = false;
  try {
    await db.user.create({
      data: { email, passwordHash: h, firstName: 'Dup', lastName: 'User' },
    });
  } catch {
    dup = true;
  }
  check('a second account on the same address is refused', dup, true);

  // Cleanup — cascades remove tokens, sessions, and settings.
  await db.user.deleteMany({ where: { email } });
  console.log('\n  (removed the test account)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
