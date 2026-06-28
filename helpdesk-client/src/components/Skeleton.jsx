export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-6 ${className}`}>
      <div className="h-3 w-24 bg-gray-200 rounded animate-pulse mb-3" />
      <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="h-3 w-32 bg-gray-200 rounded animate-pulse" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-50 last:border-0">
          <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonDetail() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
        <div className="h-20 w-full bg-gray-200 rounded animate-pulse" />
        <div className="h-12 w-full bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 w-full bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export function SkeletonForm() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="h-7 w-40 bg-gray-200 rounded animate-pulse" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse mb-1" />
          <div className="h-10 w-full bg-gray-200 rounded animate-pulse" />
        </div>
        <div>
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1" />
          <div className="h-28 w-full bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-1" />
            <div className="h-10 w-full bg-gray-200 rounded animate-pulse" />
          </div>
          <div>
            <div className="h-4 w-16 bg-gray-200 rounded animate-pulse mb-1" />
            <div className="h-10 w-full bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}
