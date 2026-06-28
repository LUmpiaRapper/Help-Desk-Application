import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { SkeletonTable } from '../components/Skeleton'

export default function TicketList() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTickets()
  }, [role])

  async function fetchTickets() {
    setLoading(true)
    const { data } = await supabase
      .from('tickets')
      .select('*, categories(name), assignee:assignee_id(name), submitter:submitter_id(name)')
      .order('created_at', { ascending: false })

    setTickets(data ?? [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-28 bg-gray-200 rounded animate-pulse" />
        </div>
        <SkeletonTable />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
        <Link
          to="/tickets/new"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          New Ticket
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 text-sm mb-4">No tickets yet.</p>
            <Link
              to="/tickets/new"
              className="text-indigo-600 text-sm font-medium hover:text-indigo-500"
            >
              Create your first ticket
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Assignee</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/tickets/${ticket.id}`)}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {ticket.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                      ticket.status === 'open' ? 'bg-blue-100 text-blue-800' :
                      ticket.status === 'in_progress' ? 'bg-purple-100 text-purple-800' :
                      ticket.status === 'resolved' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      ticket.priority === 'critical' ? 'bg-red-100 text-red-800' :
                      ticket.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                      ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {ticket.categories?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {ticket.assignee?.name ?? 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {new Date(ticket.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
