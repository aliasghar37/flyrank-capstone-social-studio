import { PLATFORMS, PROFILES } from '@studio/shared';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const phases = [
  {
    name: 'Ingestion',
    phase: 'Phase 2',
    detail: 'A URL or pasted Markdown becomes the stored source of truth.',
  },
  {
    name: 'Generation + validation',
    phase: 'Phase 2',
    detail: 'One variant per platform, enforced by code against its constraint profile.',
  },
  {
    name: 'Review workflow',
    phase: 'Phase 3',
    detail: 'Draft, approve, edit or reject. Nothing unapproved can be scheduled.',
  },
  {
    name: 'Adapters + idempotent publish',
    phase: 'Phase 4',
    detail: 'Telegram and Discord for real, mock X and LinkedIn. One interface.',
  },
  {
    name: 'Durable scheduling + history',
    phase: 'Phase 5',
    detail: 'A worker restart mid-batch never creates a duplicate post.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-4">
        <span className="w-fit rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-300">
          Foundation scaffold · Phases 2–5 in progress
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Social Media Studio
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-slate-400">
          One blog post in. Platform-specific variants out. A person approves each one, and a
          durable scheduler publishes it once — never twice.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <a
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-sky-400/40 hover:bg-slate-900"
          href={`${apiUrl}/health`}
        >
          <h2 className="text-sm font-medium text-slate-400">API health</h2>
          <p className="mt-2 font-mono text-sm text-sky-300">{apiUrl}/health</p>
          <p className="mt-3 text-sm text-slate-500">
            Checks PostgreSQL and Redis. Returns 503 when either is unavailable.
          </p>
        </a>

        <a
          className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-sky-400/40 hover:bg-slate-900"
          href={`${apiUrl}/api/platforms`}
        >
          <h2 className="text-sm font-medium text-slate-400">Platform profiles</h2>
          <p className="mt-2 font-mono text-sm text-sky-300">{apiUrl}/api/platforms</p>
          <p className="mt-3 text-sm text-slate-500">
            Enabled platforms, adapter mapping, and the constraint profiles enforced in code.
          </p>
        </a>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-widest text-slate-500">
          Constraint profiles
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORMS.map((platform) => {
            const profile = PROFILES[platform];
            return (
              <article
                key={platform}
                className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5"
              >
                <h3 className="font-medium capitalize text-slate-200">{platform}</h3>
                <p className="mt-3 text-sm text-slate-400">
                  {profile.minChars}–{profile.maxChars} characters
                </p>
                <p className="text-sm text-slate-400">
                  {profile.hashtags.min}–{profile.hashtags.max} hashtags
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">{profile.tone.label}</p>
              </article>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          These values come from <span className="font-mono">packages/shared</span>. The same object
          is used by the API and the future validator.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-widest text-slate-500">
          Build phases
        </h2>
        <ol className="grid gap-3">
          {phases.map((item) => (
            <li
              key={item.name}
              className="flex flex-col gap-1 rounded-xl border border-slate-800/80 bg-slate-900/40 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <div>
                <p className="font-medium text-slate-200">{item.name}</p>
                <p className="text-sm text-slate-500">{item.detail}</p>
              </div>
              <span className="mt-2 shrink-0 text-xs font-medium text-slate-400 sm:mt-0">
                {item.phase}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto border-t border-slate-800 pt-6 text-sm text-slate-500">
        Design and architecture: <span className="text-slate-400">docs/DESIGN.md</span> and{' '}
        <span className="text-slate-400">docs/architecture.md</span>.
      </footer>
    </main>
  );
}
