import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Bar, Pie } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const isDark = () => document.documentElement.classList.contains('dark')

const chartTextColor = () => isDark() ? '#94a3b8' : '#6b7280'
const chartGridColor = () => isDark() ? '#334155' : '#e5e7eb'

export default function AdminReports() {
  const [metrics, setMetrics] = useState(null)
  const [dailyData, setDailyData] = useState(null)
  const [categoryData, setCategoryData] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    loadMetrics()
    loadDailyChart()
    loadCategoryChart()
    const observer = new MutationObserver(() => setTick((t) => t + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  async function loadMetrics() {
    const { count: total } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })

    const { count: open } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress'])

    const { count: breached } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .not('sla_breached_at', 'is', null)

    const { data: resolvedTickets } = await supabase
      .from('tickets')
      .select('created_at, resolved_at')
      .not('resolved_at', 'is', null)

    let avgMttr = 0
    if (resolvedTickets?.length) {
      const totalHours = resolvedTickets.reduce((sum, t) => {
        const created = new Date(t.created_at)
        const resolved = new Date(t.resolved_at)
        return sum + (resolved - created) / 3600000
      }, 0)
      avgMttr = Math.round((totalHours / resolvedTickets.length) * 10) / 10
    }

    setMetrics({ total, open, breached, avgMttr, resolvedCount: resolvedTickets?.length ?? 0 })
  }

  async function loadDailyChart() {
    const { data } = await supabase
      .from('tickets')
      .select('created_at')

    if (!data?.length) return

    const last30 = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      last30[key] = 0
    }

    data.forEach((t) => {
      const key = t.created_at.slice(0, 10)
      if (key in last30) last30[key]++
    })

    setDailyData({
      labels: Object.keys(last30).map((k) => k.slice(5)),
      datasets: [{
        label: 'Tickets',
        data: Object.values(last30),
        backgroundColor: '#6366f1',
        borderRadius: 4,
      }],
    })
  }

  async function loadCategoryChart() {
    const { data } = await supabase
      .from('tickets')
      .select('categories(name)')

    if (!data?.length) return

    const counts = {}
    data.forEach((t) => {
      const name = t.categories?.name ?? 'Unknown'
      counts[name] = (counts[name] || 0) + 1
    })

    const colors = ['#6366f1', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899']

    setCategoryData({
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: colors.slice(0, Object.keys(counts).length),
      }],
    })
  }

  function exportCsv() {
    supabase.from('tickets').select('*, categories(name), assignee:assignee_id(name), submitter:submitter_id(name)').then(({ data }) => {
      if (!data?.length) return
      const headers = ['ID', 'Title', 'Status', 'Priority', 'Category', 'Assignee', 'Submitter', 'Created', 'Resolved']
      const rows = data.map((t) => [
        t.id,
        `"${t.title.replace(/"/g, '""')}"`,
        t.status,
        t.priority,
        t.categories?.name ?? '',
        t.assignee?.name ?? '',
        t.submitter?.name ?? '',
        t.created_at?.slice(0, 10) ?? '',
        t.resolved_at?.slice(0, 10) ?? '',
      ].join(','))

      const csv = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
        <button
          onClick={exportCsv}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tickets</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{metrics?.total ?? 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Now</p>
          <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{metrics?.open ?? 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg MTTR</p>
          <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{metrics?.avgMttr ?? '—'}h</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">SLA Breached</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">{metrics?.breached ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Tickets per Day (30 days)</h2>
          {dailyData ? (
            <Bar
              data={dailyData}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { maxTicksLimit: 15, font: { size: 10 }, color: chartTextColor() }, grid: { color: chartGridColor() } },
                  y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: chartTextColor() }, grid: { color: chartGridColor() } },
                },
              }}
            />
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No data yet.</p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Tickets by Category</h2>
          {categoryData ? (
            <div className="max-w-xs mx-auto">
              <Pie
                data={categoryData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 11 }, color: chartTextColor() } },
                  },
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No data yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
