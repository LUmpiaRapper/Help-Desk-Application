import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { SkeletonCard } from '../components/Skeleton'

export default function Dashboard() {
  const { user, role } = useAuth()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetchStats()
  }, [role, user])

  async function fetchStats() {
    if (role === 'user') {
      const { count: open } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('submitter_id', user.id)
        .in('status', ['open', 'in_progress'])

      const { count: resolved } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('submitter_id', user.id)
        .in('status', ['resolved', 'closed'])

      setStats({ open, resolved })
    } else if (role === 'technician') {
      const { data: assigned } = await supabase
        .from('tickets')
        .select('id, title, priority, status, sla_due_at, categories(name)')
        .eq('assignee_id', user.id)
        .not('status', 'in', '("resolved","closed")')
        .order('priority', { ascending: false })

      setStats({ assigned: assigned ?? [] })
    } else if (role === 'admin') {
      const { count: total } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })

      const { count: breached } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .not('sla_breached_at', 'is', null)

      const { count: open } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .in('status', ['open', 'in_progress'])

      setStats({ total, breached, open })
    }
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          {role === 'admin' && <SkeletonCard />}
        </div>
      </div>
    )
  }

  if (role === 'user') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Dashboard</h1>
          <Link
            to="/tickets/new"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            New Ticket
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">Open Tickets</p>
            <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{stats.open ?? 0}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">Resolved</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">{stats.resolved ?? 0}</p>
          </div>
        </div>
      </div>
    )
  }

  if (role === 'technician') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Queue</h1>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          {stats.assigned.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No tickets assigned to you.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {stats.assigned.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      ticket.priority === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                      ticket.priority === 'high' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                      ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    }`}>
                      {ticket.priority}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{ticket.categories?.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                      ticket.status === 'open' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                      ticket.status === 'in_progress' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                      'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-gray-300'
                    }`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    {ticket.sla_due_at && (
                      <span className={`text-xs font-medium ${
                        new Date(ticket.sla_due_at) < new Date() ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'
                      }`}>
                        {new Date(ticket.sla_due_at) < new Date() ? 'BREACHED' : 'SLA OK'}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
        <Link
          to="/tickets/new"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          New Ticket
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Tickets</p>
          <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{stats.total ?? 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">SLA Breached</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">{stats.breached ?? 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Now</p>
          <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.open ?? 0}</p>
        </div>
      </div>
    </div>
  )
}
