import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../contexts/ToastContext'
import ConfirmModal from '../components/ConfirmModal'
import { SkeletonDetail } from '../components/Skeleton'
import { Clock, ArrowRight, UserCheck, MessageSquare, Activity } from 'lucide-react'

const STATUSES = ['open', 'in_progress', 'resolved', 'closed']

export default function TicketDetail() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [comments, setComments] = useState([])
  const [activityLog, setActivityLog] = useState([])
  const [newComment, setNewComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [technicians, setTechnicians] = useState([])
  const [slaCountdown, setSlaCountdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showActivity, setShowActivity] = useState(false)

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

  useEffect(() => {
    const ticketChannel = supabase
      .channel(`ticket-${id}-changes`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `id=eq.${id}` },
        () => { loadTicket() }
      )
      .subscribe()

    const commentChannel = supabase
      .channel(`ticket-${id}-comments`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `ticket_id=eq.${id}` },
        (payload) => {
          const newCommentData = payload.new
          supabase.from('users').select('name, role').eq('id', newCommentData.user_id).single().then(({ data: userData }) => {
            setComments((prev) => [...prev, { ...newCommentData, user: userData }])
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ticketChannel)
      supabase.removeChannel(commentChannel)
    }
  }, [id])

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

    const [{ data: commentsData }, { data: activityData }] = await Promise.all([
      supabase.from('comments').select('*, user:user_id(name, role)').eq('ticket_id', id).order('created_at', { ascending: true }),
      supabase.from('activity_log').select('*, user:user_id(name)').eq('ticket_id', id).order('created_at', { ascending: false }).limit(50),
    ])

    setComments(commentsData ?? [])
    setActivityLog(activityData ?? [])
    setLoading(false)
  }

  async function loadTechnicians() {
    if (!canAssign) return
    const { data } = await supabase.from('users').select('id, name').in('role', ['technician', 'admin'])
    setTechnicians(data ?? [])
  }

  async function handleStatusUpdate() {
    if (newStatus === ticket.status || submitting) return
    setSubmitting(true)
    const { error } = await supabase.from('tickets').update({
      status: newStatus, resolved_at: newStatus === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', id)

    if (error) { addToast(`Status update failed: ${error.message}`, 'error') }
    else { setTicket({ ...ticket, status: newStatus }); addToast(`Status changed to ${newStatus.replace('_', ' ')}`, 'success') }
    setSubmitting(false)
  }

  async function handleAssign() {
    if (!canAssign || submitting) return
    setSubmitting(true)
    const { error } = await supabase.from('tickets').update({ assignee_id: assigneeId || null }).eq('id', id)
    if (error) { addToast(`Assignment failed: ${error.message}`, 'error') }
    else { setTicket({ ...ticket, assignee_id: assigneeId }); addToast('Ticket assigned successfully', 'success'); loadTicket() }
    setSubmitting(false)
  }

  async function handleAddComment(e) {
    e.preventDefault()
    if (!newComment.trim() || submitting) return
    setSubmitting(true)

    const { data, error } = await supabase.from('comments').insert({
      ticket_id: parseInt(id), user_id: user.id, body: newComment, is_internal: isInternal && isStaff,
    }).select('*, user:user_id(name, role)').single()

    if (error) { addToast(`Failed to post comment: ${error.message}`, 'error') }
    else { setComments([...comments, data]); setNewComment(''); setIsInternal(false); addToast('Comment posted', 'success') }
    setSubmitting(false)
  }

  async function handleDelete() {
    setShowDeleteModal(false)
    const { error } = await supabase.from('tickets').delete().eq('id', id)
    if (error) { addToast(`Delete failed: ${error.message}`, 'error') }
    else { addToast('Ticket deleted', 'success'); navigate('/tickets') }
  }

  function formatActivity(action, oldVal, newVal) {
    switch (action) {
      case 'status_change': return <span>Status changed from <strong>{oldVal?.replace('_', ' ')}</strong> to <strong>{newVal?.replace('_', ' ')}</strong></span>
      case 'assignment': return <span>Assigned to {technicians.find((t) => t.id === newVal)?.name || 'Unassigned'}</span>
      default: return <span>{action.replace('_', ' ')}</span>
    }
  }

  function getActivityIcon(action) {
    if (action === 'status_change') return <ArrowRight className="w-4 h-4" />
    if (action === 'assignment') return <UserCheck className="w-4 h-4" />
    return <Activity className="w-4 h-4" />
  }

  if (loading) return <SkeletonDetail />

  if (!ticket) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{fetchError ? `Error loading ticket: ${fetchError}` : 'Ticket not found.'}</p>
        <Link to="/tickets" className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 mt-2 inline-block">&larr; Back to tickets</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/tickets" className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500">&larr; Back to tickets</Link>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{ticket.title}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              #{ticket.id} · Submitted by {ticket.submitter?.name} · {ticket.categories?.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
              ticket.status === 'open' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
              ticket.status === 'in_progress' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
              ticket.status === 'resolved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
              'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-gray-300'
            }`}>{ticket.status.replace('_', ' ')}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              ticket.priority === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
              ticket.priority === 'high' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
              ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
              'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
            }`}>{ticket.priority}</span>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300">
          <p>{ticket.description}</p>
        </div>

        {ticket.sla_due_at && (
          <div className={`p-3 rounded-lg text-sm font-medium ${
            slaCountdown === 'OVERDUE' || ticket.sla_breached_at
              ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
              : 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:border-slate-600'
          }`}>
            <Clock className="inline w-4 h-4 mr-1.5 -mt-0.5" />
            SLA: {slaCountdown || (ticket.sla_breached_at ? 'BREACHED' : 'Calculating...')}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>Assignee:</span>
          <strong className="text-gray-700 dark:text-gray-200">{ticket.assignee?.name ?? 'Unassigned'}</strong>
        </div>

        {isStaff && (
          <div className="border-t border-gray-100 dark:border-slate-700 pt-4 space-y-4">
            <div className="flex items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {STATUSES.map((s) => (<option key={s} value={s}>{s.replace('_', ' ')}</option>))}
                </select>
              </div>
              <button onClick={handleStatusUpdate} disabled={newStatus === ticket.status || submitting}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">Update</button>
            </div>

            {canAssign && (
              <div className="flex items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Assign to</label>
                  <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Unassigned</option>
                    {technicians.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                  </select>
                </div>
                <button onClick={handleAssign} disabled={submitting}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">Assign</button>
              </div>
            )}
          </div>
        )}

        {(role === 'admin') && (
          <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
            <button onClick={() => setShowDeleteModal(true)} className="text-sm text-red-600 dark:text-red-400 hover:text-red-500">Delete ticket</button>
          </div>
        )}

        <ConfirmModal open={showDeleteModal} title="Delete ticket"
          message={`Are you sure you want to delete "${ticket.title}"? This cannot be undone.`}
          confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setShowDeleteModal(false)} />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Comments ({comments.length})</h2>

        <div className="space-y-4 mb-6">
          {comments.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet.</p>
          ) : (
            comments.map((comment) => {
              const isStaffNote = comment.is_internal
              return (
                <div key={comment.id} className={`p-4 rounded-lg ${isStaffNote ? 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800' : 'bg-gray-50 border border-gray-100 dark:bg-slate-700/50 dark:border-slate-700'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{comment.user?.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 capitalize">{comment.user?.role}</span>
                      {isStaffNote && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Internal</span>}
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(comment.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{comment.body}</p>
                </div>
              )
            })
          )}
        </div>

        <form onSubmit={handleAddComment} className="space-y-3">
          <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            rows={3} placeholder="Add a comment..." required />
          <div className="flex items-center justify-between">
            {isStaff && (
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500" />
                Internal note (staff only)
              </label>
            )}
            <button type="submit" disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              <MessageSquare className="inline w-4 h-4 mr-1.5 -mt-0.5" /> Post comment
            </button>
          </div>
        </form>
      </div>

      {isStaff && activityLog.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
          <button onClick={() => setShowActivity(!showActivity)}
            className="flex items-center justify-between w-full text-left">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Activity</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{showActivity ? 'Hide' : `Show (${activityLog.length})`}</span>
          </button>
          {showActivity && (
            <div className="mt-4 space-y-3">
              {activityLog.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 p-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                    {getActivityIcon(entry.action)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-700 dark:text-gray-300">{formatActivity(entry.action, entry.old_value, entry.new_value)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {entry.user?.name} · {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
