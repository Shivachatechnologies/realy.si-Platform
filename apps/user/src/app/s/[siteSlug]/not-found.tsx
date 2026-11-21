/** Unknown page of a published site (or an offline / unknown site). Kept neutral: it may not belong to any company. */
export default function SiteNotFound() {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl content-center justify-items-center gap-3 px-4 py-16 text-center">
      <p className="text-6xl font-bold text-slate-200">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-slate-500">This page does not exist or is not published.</p>
    </main>
  );
}
