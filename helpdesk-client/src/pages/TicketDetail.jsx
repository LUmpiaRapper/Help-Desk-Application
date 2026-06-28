import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const STATUSES = ['open', 'in_progress', 'resolved', 'closed']

export default function TicketDetail() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [technicians, setTechnicians] = useState([])
  const [slaCountdown, setSlaCountdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  const isStaff = role === 'technician' || role === 'admin'
  const canAssign = role === 'admin'

  useEffect(() => {
    loadTicket()
    loadTechnicians()
  }, [id])

  useEffect(() => {
    if (!ticket?.sla_due_at) return
    const interval = setInterval(() => {
      const diff = new Date(ticket.sla_due_at) - new Date()
      if (diff <= 0) {
        setSlaCountdown('OVERDUE')
        clearInterval(interval)
      } else {
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setSlaCountdown(`${h}h ${m}m ${s}s`)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [ticket?.sla_due_at])

  async function loadTicket() {
    setLoading(true)
    setFetchError('')
    const { data, error } = await supabase
      .from('tickets')
      .select('*, categories(name), assignee:assignee_id(name), submitter:submitter_id(name)')
      .eq('id', id)
      .single()

    if (error) {
      setFetchError(error.message)
      setLoading(false)
      return
    }

    setTicket(data)
    setNewStatus(data?.status ?? '')
    setAssigneeId(data?.assignee_id ?? '')

    const { data: commentsData } = await supabase
      .from('comments')
      .select('*, user:user_id(name, role)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true })

    setComments(commentsData ?? [])
    setLoading(false)
  }

  async function loadTechnicians() {
    if (!canAssign) return
    const { data } = await supabase
      .from('users')
      .select('id, name')
      .in('role', ['technician', 'admin'])
    setTechnicians(data ?? [])
  }

  async function handleStatusUpdate() {
    if (newStatus === ticket.status) return
    const { error } = await supabase
      .from('tickets')
      .update({
        status: newStatus,
        resolved_at: newStatus === 'resolved' ? new Date().toISOString() : null,
      })
      .eq('id', id)

    if (!error) {
      setTicket({ ...ticket, status: newStatus })
    }
  }

  async function handleAssign() {
    if (!canAssign) return
    const { error } = await supabase
      .from('tickets')
      .update({ assignee_id: assigneeId || null })
      .eq('id', id)

    if (!error) {
      setTicket({ ...ticket, assignee_id: assigneeId })
      loadTicket()
    }
  }

  async function handleAddComment(e) {
    e.preventDefault()
    if (!newComment.trim()) return

    const { data, error } = await supabase
      .from('comments')
      .insert({
        ticket_id: parseInt(id),
        user_id: user.id,
        body: newComment,
        is_internal: isInternal && isStaff,
      })
      .select('*, user:user_id(name, role)')
      .single()

    if (!error) {
      setComments([...comments, data])
      setNewComment('')
      setIsInternal(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this ticket?')) return
    await supabase.from('tickets').delete().eq('id', id)
    navigate('/tickets')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <p className="text-gray-500">
          {fetchError ? `Error loading ticket: ${fetchError}` : 'Ticket not found.'}
        </p>
        <Link to="/tickets" className="text-sm text-indigo-600 hover:text-indigo-500 mt-2 inline-block">
          &larr; Back to tickets
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/tickets" className="text-sm text-indigo-600 hover:text-indigo-500">&larr; Back to tickets</Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{ticket.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              #{ticket.id} · Submitted by {ticket.submitter?.name} · {ticket.categories?.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
              ticket.status === 'open' ? 'bg-blue-100 text-blue-800' :
              ticket.status === 'in_progress' ? 'bg-purple-100 text-purple-800' :
              ticket.status === 'resolved' ? 'bg-green-100 text-green-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {ticket.status.replace('_', ' ')}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              ticket.priority === 'critical' ? 'bg-red-100 text-red-800' :
              ticket.priority === 'high' ? 'bg-orange-100 text-orange-800' :
              ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
              'bg-green-100 text-green-800'
            }`}>
              {ticket.priority}
            </span>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-gray-700">
          <p>{ticket.description}</p>
        </div>

        {ticket.sla_due_at && (
          <div className={`p-3 rounded-lg text-sm font-medium ${
            slaCountdown === 'OVERDUE' || ticket.sla_breached_at
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-gray-50 text-gray-600 border border-gray-200'
          }`}>
            SLA: {slaCountdown || (ticket.sla_breached_at ? 'BREACHED' : 'Calculating...')}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Assignee:</span>
          <strong className="text-gray-700">{ticket.assignee?.name ?? 'Unassigned'}</strong>
        </div>

        {isStaff && (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div className="flex items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleStatusUpdate}
                disabled={newStatus === ticket.status}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Update
              </button>
            </div>

            {canAssign && (
              <div className="flex items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Assign to</label>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAssign}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        )}

        {(role === 'admin') && (
          <div className="border-t border-gray-100 pt-4">
            <button onClick={handleDelete} className="text-sm text-red-600 hover:text-red-500">
              Delete ticket
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Comments ({comments.length})
        </h2>

        <div className="space-y-4 mb-6">
          {comments.length === 0 ? (
            <p className="text-sm text-gray-500">No comments yet.</p>
          ) : (
            comments.map((comment) => {
              const isStaffNote = comment.is_internal
              return (
                <div
                  key={comment.id}
                  className={`p-4 rounded-lg ${
                    isStaffNote
                      ? 'bg-yellow-50 border border-yellow-200'
                      : 'bg-gray-50 border border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {comment.user?.name}
                      </span>
                      <span className="text-xs text-gray-400 capitalize">
                        {comment.user?.role}
                      </span>
                      {isStaffNote && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-200 text-yellow-800">
                          Internal
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(comment.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{comment.body}</p>
                </div>
              )
            })
          )}
        </div>

        <form onSubmit={handleAddComment} className="space-y-3">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            rows={3}
            placeholder="Add a comment..."
            required
          />
          <div className="flex items-center justify-between">
            {isStaff && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Internal note (staff only)
              </label>
            )}
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Post comment
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
