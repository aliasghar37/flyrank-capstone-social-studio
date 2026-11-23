import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-sky-300">404</p>
      <h1 className="text-3xl font-semibold text-white">Page not found</h1>
      <p className="text-slate-400">This dashboard page has not been built yet.</p>
      <Link
        className="mt-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-sky-400/40"
        href="/"
      >
        Back to the studio
      </Link>
    </main>
  );
}
