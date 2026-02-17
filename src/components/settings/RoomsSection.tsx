import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { createInvite } from '../../lib/supabase/auth'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export function RoomsSection() {
  const { rooms, roomId, currentRoom, switchRoom, isAuthenticated, inviteResult, clearInviteResult } = useAuth()
  const { showToast } = useToast()
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [isSwitching, setIsSwitching] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Web link uses page origin so it's accessible from any browser
  const webLink = inviteCode ? `${window.location.origin}?invite=${inviteCode}` : null

  // Show invite result as toast
  useEffect(() => {
    if (!inviteResult) return
    if (inviteResult.status === 'joined') {
      showToast(`Joined room "${inviteResult.room_name}"`, 'success')
    } else if (inviteResult.status === 'already_member') {
      showToast(`Already in room "${inviteResult.room_name}"`, 'info')
    } else if (inviteResult.status === 'expired') {
      showToast('Invite link has expired', 'error')
    } else if (inviteResult.status === 'not_found') {
      showToast('Invite link is invalid', 'error')
    }
    clearInviteResult()
  }, [inviteResult])

  if (!isAuthenticated) return null

  const handleSwitchRoom = async (newRoomId: string) => {
    if (newRoomId === roomId || isSwitching) return
    setIsSwitching(newRoomId)
    try {
      await switchRoom(newRoomId)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to switch room', 'error')
    } finally {
      setIsSwitching(null)
    }
  }

  const handleCreateInvite = async () => {
    if (!roomId || isCreatingInvite) return
    setIsCreatingInvite(true)
    try {
      const result = await createInvite(roomId)
      setInviteCode(result.invite.invite_code)
      setDeepLink(result.deep_link)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create invite', 'error')
    } finally {
      setIsCreatingInvite(false)
    }
  }

  const handleCopyLink = async () => {
    if (!webLink) return
    try {
      await navigator.clipboard.writeText(webLink)
    } catch {
      const input = document.createElement('input')
      input.value = webLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    showToast('Link copied!', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShareTelegram = () => {
    if (!deepLink || !currentRoom) return
    const text = `Join my room "${currentRoom.name}" in Shop Assist!`
    const url = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  return (
    <section className="mb-6">
      <h2 className="text-[20px] font-semibold text-text mb-4">Rooms</h2>

      <div className="bg-surface rounded-xl border border-separator/30 overflow-hidden">
        {rooms.map((room, i) => (
          <button
            key={room.id}
            onClick={() => handleSwitchRoom(room.id)}
            disabled={room.id === roomId || !!isSwitching}
            className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
              i > 0 ? 'border-t border-separator/20' : ''
            } ${
              room.id === roomId
                ? 'bg-primary/5'
                : 'active:bg-bg-secondary'
            } ${isSwitching === room.id ? 'opacity-50' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] text-text font-medium truncate">
                  {room.name}
                </span>
                {room.is_personal && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-bg-secondary text-text-hint shrink-0">
                    Personal
                  </span>
                )}
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary-text shrink-0">
                  {ROLE_LABELS[room.role] || room.role}
                </span>
              </div>
            </div>
            {room.id === roomId && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-text shrink-0 ml-2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {isSwitching === room.id && (
              <div className="w-4 h-4 border-2 border-primary-text border-t-transparent rounded-full animate-spin shrink-0 ml-2" />
            )}
          </button>
        ))}
      </div>

      {/* Share / Invite */}
      <div className="mt-4 bg-surface rounded-xl p-4 border border-separator/30">
        <p className="text-[13px] text-text-hint mb-3">
          Share your current room to let others see and edit your data
        </p>

        {!inviteCode ? (
          <button
            onClick={handleCreateInvite}
            disabled={isCreatingInvite}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-[15px] font-medium active:opacity-80 transition-opacity disabled:opacity-50"
          >
            {isCreatingInvite ? 'Creating link...' : 'Share room'}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 bg-bg-secondary rounded-lg">
              <span className="text-[12px] text-text-hint truncate flex-1">{webLink}</span>
              <button
                onClick={handleCopyLink}
                className="shrink-0 px-3 py-1 rounded-md bg-primary/10 text-primary-text text-[13px] font-medium active:bg-primary/20"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={handleShareTelegram}
              className="w-full py-2.5 rounded-lg bg-[#2AABEE] text-white text-[15px] font-medium active:opacity-80 transition-opacity flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Share in Telegram
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
