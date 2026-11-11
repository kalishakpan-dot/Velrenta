import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-slate-100">
      <h2 className="text-xl font-bold mb-2">Page Not Found</h2>
      <p className="text-sm text-slate-400 mb-4">Could not find requested resource.</p>
      <Link 
        href="/" 
        className="px-4 py-2 bg-emerald-500 text-slate-950 rounded-lg text-xs font-bold hover:bg-emerald-400 transition"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}