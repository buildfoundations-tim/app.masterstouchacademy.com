/**
 * Seed the catalog.
 *
 * The courses and classes here mirror the marketing site's inc/data.php, which
 * is currently the source of truth. Once Admin → Classes exists, this database
 * becomes the source and the marketing site reads from an API instead — at
 * which point this seed becomes first-run data only.
 *
 * Run: npm run db:seed
 */
// Runs under tsx (see the db:seed script). Node's native type stripping cannot
// load this: the generated Prisma client uses extensionless internal imports,
// which Node's ESM resolver rejects.
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

type SeedCourse = {
  slug: string;
  code: string;
  group: 'iicrc' | 'cec';
  title: string;
  blurb: string;
  description: string;
  priceCents: number;
  priceLiveCents?: number;
  hours: number;
  days: string;
  level: string;
  tag: string;
  topics: string[];
};

const COURSES: SeedCourse[] = [
  {
    slug: 'wrt', code: 'WRT', group: 'iicrc', title: 'Water Damage Restoration Technician',
    blurb: 'Water damage, its effects on a structure, and the techniques used to dry it.',
    description:
      'Written for restoration personnel doing the remediation work. Covers the concepts behind water damage and its effects, drying techniques for structures, and the procedures for water losses, sewer backflows, and contamination such as mold. Eighteen hours over three days, not counting exam time, lunch, and breaks.',
    priceCents: 45000, priceLiveCents: 35000, hours: 18, days: '3 days',
    level: 'Certification', tag: 'Water',
    topics: ['Water damage and its effects on a structure', 'Drying techniques for structures', 'Procedures for water losses', 'Sewer backflows', 'Contamination such as mold', 'Use of decontamination equipment'],
  },
  {
    slug: 'cct', code: 'CCT', group: 'iicrc', title: 'Carpet Cleaning Technician',
    blurb: 'Fiber and construction identification, cleaning science, and correct procedure on installed carpet.',
    description:
      'The art and science of carpet cleaning, weighted toward practical application: identifying fiber, yarn and carpet construction, style types and finishes, soiling conditions, and cleaning methodology. Covers pre-inspection, fabric identification, chemicals and equipment, and proper technique with a residential and light commercial emphasis. CCT is a prerequisite for several other IICRC courses.',
    priceCents: 32500, priceLiveCents: 22500, hours: 14, days: '2 days',
    level: 'Certification', tag: 'Cleaning',
    topics: ['Pre-inspection', 'Fiber, yarn, and carpet construction', 'Style types and finishes', 'Soiling conditions', 'Cleaning science and methodology', 'Basic cleaning chemicals and equipment', 'Technique for residential and light commercial work'],
  },
  {
    slug: 'rrt', code: 'RRT', group: 'iicrc', title: 'Carpet Repair and Re-installation Technician',
    blurb: 'Repair, re-installation, seaming, and stretching, plus the problems cleaners run into.',
    description:
      'Techniques and safety around carpet repair and re-installation: carpet construction, pre-cleaning inspection, tools, floor preparation, adhesives, cushion installation, tackless strip and moldings, seaming, and proper stretching. Also covers the repairs a cleaner or restorer meets on an installed textile, and how to recognize and avoid installation problems. Exam time is included.',
    priceCents: 35000, priceLiveCents: 25000, hours: 14, days: '2 days',
    level: 'Certification', tag: 'Cleaning',
    topics: ['Carpet construction', 'Inspection before cleaning', 'Tools of the trade', 'Floor preparation and adhesives', 'Carpet cushion installation', 'Tackless strip and moldings', 'Seaming and proper stretching', 'Repairs a cleaner meets on an installed textile'],
  },
  {
    slug: 'crt', code: 'CRT', group: 'iicrc', title: 'Color Repair Technician',
    blurb: 'Color theory, dyes, and repairing color loss on carpet.',
    description:
      'The history of color, color theory, natural and synthetic dyes, dye methods, dye types, fiber types, carpet styles, and dye procedures. Also covers color-related cleaning issues: fading, color loss from contamination or bleaching, and cleaning agents that affect or remove color. This course has mandatory hands-on work.',
    // CRT is the one exception to "live stream is $100 under the classroom seat" —
    // live-stream students are shipped hands-on materials, so it prices above.
    priceCents: 35000, priceLiveCents: 45000, hours: 14, days: '2 days',
    level: 'Certification', tag: 'Cleaning',
    topics: ['The history of color and color theory', 'Natural and synthetic dyes', 'Dye methods and dye types', 'Fiber types and carpet styles', 'Dye procedures', 'Fading and color loss from contamination or bleaching', 'Cleaning agents that affect or remove color'],
  },
  {
    slug: 'oct', code: 'OCT', group: 'iicrc', title: 'Odor Control Technician',
    blurb: 'Odor sources, detection, and the equipment and chemistry that actually remove them.',
    description:
      'Olfaction and odor, odor sources, the detection process, the theory of odor control, equipment, and chemical options and applications. Students learn to address odors from biological sources such as decomposition, urine contamination, and mold; combustion sources such as fire and smoke; and chemical sources such as fuel oil spills and volatile organic chemicals. One day, seven hours.',
    priceCents: 22500, priceLiveCents: 12500, hours: 7, days: '1 day',
    level: 'Certification', tag: 'Specialty',
    topics: ['Olfaction and odor', 'Odor sources and the detection process', 'Theory of odor control', 'Equipment', 'Chemical options and applications', 'Biological odors: decomposition, urine, mold', 'Combustion and chemical source odors'],
  },
  {
    slug: 'uft', code: 'UFT', group: 'iicrc', title: 'Upholstery and Fabric Cleaning Technician',
    blurb: 'Fiber identification, furniture construction, and cleaning methods for upholstery.',
    description:
      'Upholstery fiber categories, fiber identification and testing, how the fiber and fabric are manufactured, the chemistry of cleaning, cleaning methods, protectors, spotting, and potential problems. Students come away able to identify fabric and fiber content and furniture construction, and with it the limitations and likely cleaning problems on a given piece.',
    priceCents: 35000, priceLiveCents: 25000, hours: 14, days: '2 days',
    level: 'Certification', tag: 'Cleaning',
    topics: ['Upholstery fiber categories', 'Fiber identification and testing', 'How fiber and fabric are manufactured', 'The chemistry of cleaning', 'Upholstery cleaning methods', 'Protectors', 'Spotting and potential problems', 'Furniture construction and its limitations'],
  },
  {
    slug: 'cecupholstery', code: 'CEC', group: 'cec', title: 'Upholstery Cleaning Fundamentals',
    blurb: 'Fabric identification, tools, and a repeatable process for cleaning upholstery on site.',
    description:
      'A continuing education course on the fundamentals of upholstery cleaning: identifying fabric and fiber content, selecting the right chemistry and tool for the piece, controlling moisture, and working through a cushion set without overwetting or leaving rings.',
    priceCents: 8999, hours: 4, days: 'Self-paced',
    level: 'Continuing education', tag: 'Continuing education',
    topics: ['Fabric and fiber identification', 'Chemistry and tool selection', 'Moisture control', 'Working a cushion set', 'Avoiding rings and overwetting'],
  },
  {
    slug: 'cecspot', code: 'CEC', group: 'cec', title: 'Basic and Advanced Spot and Stain Removal',
    blurb: 'Identifying what the spot is, then removing it without setting it or damaging the fiber.',
    description:
      'A continuing education course covering spot and stain identification, the chemistry behind removal, and the order of operations that keeps a stain from setting. Moves from routine spotting through the difficult ones: dye, rust, ink, pet, and unknown residues.',
    priceCents: 8999, hours: 4, days: 'Self-paced',
    level: 'Continuing education', tag: 'Continuing education',
    topics: ['Spot and stain identification', 'The chemistry of removal', 'Order of operations', 'Dye, rust, and ink', 'Pet and unknown residues'],
  },
  {
    slug: 'ceccarpet', code: 'CEC', group: 'cec', title: 'Carpet Cleaning Fundamentals',
    blurb: 'Pre-inspection, fiber and soil identification, and correct procedure on installed carpet.',
    description:
      'A continuing education course on carpet cleaning fundamentals: pre-inspection, identifying fiber and construction, reading soiling conditions, choosing the right method, and the technique that gets a residential job clean and dry.',
    priceCents: 8999, hours: 4, days: 'Self-paced',
    level: 'Continuing education', tag: 'Continuing education',
    topics: ['Pre-inspection', 'Fiber and construction identification', 'Reading soiling conditions', 'Choosing a cleaning method', 'Technique, drying, and grooming'],
  },
  {
    slug: 'cecodor', code: 'CEC', group: 'cec', title: 'Odor Control Fundamentals',
    blurb: 'Finding the odor source and removing it, rather than covering it up.',
    description:
      'A continuing education course on odor control fundamentals: how olfaction works, locating the source, the theory behind odor removal, and the equipment and chemistry that address biological, combustion, and chemical odors.',
    priceCents: 8999, hours: 4, days: 'Self-paced',
    level: 'Continuing education', tag: 'Continuing education',
    topics: ['How olfaction works', 'Locating the odor source', 'Theory of odor control', 'Equipment and chemistry', 'Biological, combustion, and chemical odors'],
  },
  {
    slug: 'cecleather', code: 'CEC', group: 'cec', title: 'Leather Repair and Care',
    blurb: 'Identifying leather types, cleaning and conditioning, and repairing damage and color loss.',
    description:
      'A continuing education course on leather: identifying the type and finish, cleaning and conditioning without stripping the topcoat, and repairing scuffs, cracks, dye transfer, and color loss. The most technical course in the CEC library and priced accordingly.',
    priceCents: 45000, hours: 8, days: 'Self-paced',
    level: 'Continuing education', tag: 'Continuing education',
    topics: ['Leather types and finishes', 'Cleaning without stripping the topcoat', 'Conditioning', 'Repairing scuffs and cracks', 'Dye transfer and color loss', 'Color matching and refinishing'],
  },
];

const CLASSES = [
  {
    courseSlug: 'wrt', title: 'IICRC Water Damage Restoration Technician (WRT)',
    start: '2026-09-09', end: '2026-09-11', dateLabel: 'Sep 9–11, 2026',
    seats: 6, inPersonCents: 45000, virtualCents: 35000,
    note: 'Three-day certification course, 18 hours. Live-stream attendees join with Q&A and receive the same course materials.',
  },
  {
    courseSlug: 'oct', title: 'IICRC Odor Control Technician (OCT)',
    start: '2026-09-24', end: '2026-09-24', dateLabel: 'Sep 24, 2026',
    seats: 9, inPersonCents: 22500, virtualCents: 12500,
    note: 'One-day certification course, 7 hours. The shortest route to an added credential.',
  },
  {
    courseSlug: 'cct', title: 'IICRC Carpet Cleaning Technician (CCT)',
    start: '2026-10-21', end: '2026-10-22', dateLabel: 'Oct 21–22, 2026',
    seats: 12, inPersonCents: 32500, virtualCents: 22500,
    note: 'Two-day certification course, 14 hours. Prerequisite for several other IICRC courses.',
  },
];

const LOCATION = 'Masters Touch Training Center — Cleveland, OH';

async function main() {
  console.log('Seeding…');

  // ── Owner + demo members ──────────────────────────────────
  //
  // These carry a password that is printed below and written in the docs, so
  // they must never exist in production. Creating them requires SEED_DEMO_USERS
  // to be set explicitly — running this against a production database without
  // it seeds the catalog and nothing else.
  const seedDemoUsers = process.env.SEED_DEMO_USERS === 'true';

  if (!seedDemoUsers) {
    console.log('  users: skipped (set SEED_DEMO_USERS=true for local demo accounts)');
  }

  const password = await hash(process.env.SEED_DEMO_PASSWORD || 'academy-dev-2026');

  const tom = !seedDemoUsers ? null : await db.user.upsert({
    where: { email: 'tom@masterstouchacademy.com' },
    update: {},
    create: {
      email: 'tom@masterstouchacademy.com',
      passwordHash: password,
      firstName: 'Thomas',
      lastName: 'Cermak',
      displayName: 'Tom',
      company: 'Masters Touch Academy',
      role: 'Founder and lead instructor',
      city: 'Cleveland, OH',
      tier: 4,
      isOwner: true,
      isInstructor: true,
      onboardedAt: new Date(),
      settings: { create: {} },
    },
  });

  // Two members at different tiers, so the entitlement rules are visible
  // immediately: the Community member sees the CEC library locked, the Pro
  // member sees it open, and both see IICRC courses locked.
  const community = !seedDemoUsers ? null : await db.user.upsert({
    where: { email: 'community@example.com' },
    update: {},
    create: {
      email: 'community@example.com',
      passwordHash: password,
      firstName: 'Jordan',
      lastName: 'Diaz',
      company: 'Diaz Restoration',
      tier: 1,
      onboardedAt: new Date(),
      settings: { create: {} },
    },
  });

  const pro = !seedDemoUsers ? null : await db.user.upsert({
    where: { email: 'pro@example.com' },
    update: {},
    create: {
      email: 'pro@example.com',
      passwordHash: password,
      firstName: 'Sara',
      lastName: 'Kim',
      company: 'Northcoast Cleaning',
      tier: 2,
      onboardedAt: new Date(),
      settings: { create: {} },
    },
  });

  if (seedDemoUsers) console.log(`  users: ${[tom, community, pro].filter(Boolean).length}`);

  // ── Courses ───────────────────────────────────────────────
  for (const [i, c] of COURSES.entries()) {
    await db.course.upsert({
      where: { slug: c.slug },
      update: {
        title: c.title,
        priceCents: c.priceCents,
        priceLiveCents: c.priceLiveCents ?? null,
      },
      create: {
        slug: c.slug,
        code: c.code,
        group: c.group,
        title: c.title,
        blurb: c.blurb,
        description: c.description,
        priceCents: c.priceCents,
        priceLiveCents: c.priceLiveCents ?? null,
        hours: c.hours,
        days: c.days,
        level: c.level,
        tag: c.tag,
        ceHours: c.hours,
        published: true,
        sortOrder: i,
        instructorId: c.group === 'cec' ? (tom?.id ?? null) : null,
      },
    });
  }
  console.log(`  courses: ${COURSES.length}`);

  // ── One fully built course, so the player has real content ─
  // cecupholstery is deliberate: it is a CEC course, so a Pro member can open
  // it and a Community member cannot — which exercises the access rule.
  const demo = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });
  const existingModules = await db.module.count({ where: { courseId: demo.id } });

  if (existingModules === 0) {
    const topics = COURSES.find((c) => c.slug === 'cecupholstery')!.topics;

    for (const [mi, topic] of topics.entries()) {
      await db.module.create({
        data: {
          courseId: demo.id,
          title: topic,
          position: mi,
          lessons: {
            create: [
              {
                title: `${topic} — walkthrough`,
                type: 'video',
                position: 0,
                assetKey: `cecupholstery-${mi * 2 + 1}`,
                durationSeconds: 480 + mi * 60,
              },
              {
                title: `${topic} — field notes`,
                type: 'text',
                position: 1,
                body:
                  'Placeholder lesson body. Real course copy comes from the ' +
                  'instructor; this exists so the player, progress tracking, and ' +
                  'completion can be exercised end to end.',
              },
            ],
          },
        },
      });
    }

    // Final exam. Two questions is enough to exercise scoring and the pass
    // threshold; the real bank comes from the course builder.
    await db.quiz.create({
      data: {
        title: 'Upholstery Cleaning Fundamentals — final exam',
        finalForCourseId: demo.id,
        questions: {
          create: [
            {
              position: 0,
              prompt: 'What is the first step before applying any cleaning agent to an unknown fabric?',
              options: [
                'Apply the strongest solvent available',
                'Test fiber content and colorfastness in an inconspicuous area',
                'Saturate the cushion and extract',
                'Vacuum only',
              ],
              correct: 1,
            },
            {
              position: 1,
              prompt: 'Overwetting a cushion set most commonly causes which problem?',
              options: [
                'Improved cleaning results',
                'Faster drying',
                'Rings, browning, and cover shrinkage',
                'Increased colorfastness',
              ],
              correct: 2,
            },
          ],
        },
      },
    });
    console.log(`  demo course built: ${topics.length} modules, ${topics.length * 2} lessons, 1 final exam`);
  }

  // ── Scheduled classes ─────────────────────────────────────
  for (const k of CLASSES) {
    const course = await db.course.findUniqueOrThrow({ where: { slug: k.courseSlug } });
    const existing = await db.scheduledClass.findFirst({
      where: { courseId: course.id, startDate: new Date(k.start) },
    });
    if (existing) continue;

    await db.scheduledClass.create({
      data: {
        courseId: course.id,
        title: k.title,
        mode: 'hybrid',
        startDate: new Date(k.start),
        endDate: new Date(k.end),
        dateLabel: k.dateLabel,
        location: LOCATION,
        note: k.note,
        seatsTotal: k.seats,
        inPersonPriceCents: k.inPersonCents,
        virtualPriceCents: k.virtualCents,
        published: true,
      },
    });
  }
  console.log(`  classes: ${CLASSES.length}`);

  if (seedDemoUsers) {
    console.log('\nDone. Sign in with:');
    console.log('  tom@masterstouchacademy.com  (owner, tier 4)');
    console.log('  pro@example.com              (Pro, tier 2)');
    console.log('  community@example.com        (Community, tier 1)');
    console.log(`  password: ${process.env.SEED_DEMO_PASSWORD || 'academy-dev-2026'}`);
  } else {
    console.log('\nDone. Catalog seeded; no user accounts were created.');
    console.log('Create the owner account by signing up at /signup, then promote it:');
    console.log('  npx tsx scripts/make-owner.ts you@example.com');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
