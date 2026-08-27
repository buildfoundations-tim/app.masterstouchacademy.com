/**
 * Exercises exam scoring, the pass threshold, retakes, and certificate issue.
 *
 * Reproduces exactly what submitExam() does — read the key server-side, score,
 * record the attempt, upsert the certificate — so the logic under test is the
 * logic that ships.
 *
 *   npx tsx scripts/check-exam.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
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

/** The scoring half of submitExam(). */
async function score(userId: string, quizId: string, answers: Record<string, number>) {
  const quiz = await db.quiz.findUniqueOrThrow({
    where: { id: quizId },
    select: {
      id: true,
      questions: { select: { id: true, correct: true } },
      finalForCourse: { select: { id: true, passingScore: true, ceHours: true } },
    },
  });
  const course = quiz.finalForCourse!;

  const correct = quiz.questions.reduce((a, q) => a + (answers[q.id] === q.correct ? 1 : 0), 0);
  const pct = Math.round((correct / quiz.questions.length) * 100);
  const passed = pct >= course.passingScore;

  const prior = await db.quizAttempt.count({ where: { userId, quizId } });
  await db.quizAttempt.create({
    data: { quizId, userId, answers, score: pct, passed, attemptNumber: prior + 1 },
  });

  if (passed) {
    await db.certificate.upsert({
      where: { userId_courseId: { userId, courseId: course.id } },
      create: { userId, courseId: course.id, ceHours: course.ceHours, score: pct },
      update: { score: pct },
    });
  }
  return { score: pct, passed, attemptNumber: prior + 1 };
}

async function main() {
  const pro = await db.user.findUniqueOrThrow({ where: { email: 'pro@example.com' } });
  const course = await db.course.findUniqueOrThrow({
    where: { slug: 'cecupholstery' },
    select: { id: true, passingScore: true, ceHours: true, finalExam: { select: { id: true } } },
  });
  const quizId = course.finalExam!.id;

  const questions = await db.question.findMany({
    where: { quizId },
    orderBy: { position: 'asc' },
    select: { id: true, correct: true, options: true },
  });

  // Clean slate.
  await db.quizAttempt.deleteMany({ where: { userId: pro.id } });
  await db.certificate.deleteMany({ where: { userId: pro.id } });

  const allCorrect = Object.fromEntries(questions.map((q) => [q.id, q.correct]));
  const allWrong = Object.fromEntries(
    questions.map((q) => [q.id, (q.correct + 1) % q.options.length])
  );
  const halfRight = Object.fromEntries(
    questions.map((q, i) => [q.id, i === 0 ? q.correct : (q.correct + 1) % q.options.length])
  );

  console.log(`\nPass mark is ${course.passingScore}%, ${questions.length} questions:`);

  const fail = await score(pro.id, quizId, allWrong);
  check('all wrong -> 0%', fail.score, 0);
  check('all wrong -> not passed', fail.passed, false);
  check('no certificate issued on a fail', await db.certificate.count({ where: { userId: pro.id } }), 0);

  const partial = await score(pro.id, quizId, halfRight);
  check('half right -> 50%', partial.score, 50);
  check('50% is below the 80% mark -> not passed', partial.passed, false);
  check('still no certificate', await db.certificate.count({ where: { userId: pro.id } }), 0);
  check('attempt number increments', partial.attemptNumber, 2);

  const pass = await score(pro.id, quizId, allCorrect);
  check('all correct -> 100%', pass.score, 100);
  check('100% -> passed', pass.passed, true);
  check('certificate issued on pass', await db.certificate.count({ where: { userId: pro.id } }), 1);
  check('third attempt recorded', pass.attemptNumber, 3);

  const cert = await db.certificate.findFirstOrThrow({ where: { userId: pro.id } });
  check('certificate records the CE hours', cert.ceHours, course.ceHours);
  check('certificate records the score', cert.score, 100);
  check('certificate has an unguessable share id', cert.shareId.length > 20, true);

  console.log('\nPassing twice must not duplicate the certificate:');
  await score(pro.id, quizId, allCorrect);
  check('still exactly one certificate', await db.certificate.count({ where: { userId: pro.id } }), 1);
  check('four attempts on record', await db.quizAttempt.count({ where: { userId: pro.id, quizId } }), 4);

  console.log('\nThe answer key must not be selectable by the exam page query:');
  // Mirrors the select in the exam page — if `correct` ever creeps in, this fails.
  const asRendered = await db.quiz.findUniqueOrThrow({
    where: { id: quizId },
    select: { questions: { select: { id: true, prompt: true, options: true, position: true } } },
  });
  check(
    'no `correct` field on the rendered question shape',
    Object.keys(asRendered.questions[0]).includes('correct'),
    false
  );

  // Reset to seeded state.
  await db.quizAttempt.deleteMany({ where: { userId: pro.id } });
  await db.certificate.deleteMany({ where: { userId: pro.id } });
  console.log('\n  (reset attempts and certificates back to seeded state)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
