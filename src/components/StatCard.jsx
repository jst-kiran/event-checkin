export default function StatCard({ icon: Icon, label, value, sublabel, accent = 'brand' }) {
  const ACCENTS = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{value}</p>
          {sublabel && <p className="text-xs text-slate-400 mt-1 truncate">{sublabel}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${ACCENTS[accent]}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
