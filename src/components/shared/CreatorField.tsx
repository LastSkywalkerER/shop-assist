import { useState, useRef, useEffect } from 'react'
import { saveCustomName } from '../../lib/supabase/auth'
import { useRoomMembers } from '../../hooks/useRoomMembers'
import type { RoomMember } from '../../lib/supabase/types'

interface CreatorFieldProps {
  value: string
  onChange: (name: string) => void
  roomId: string | null
}

export function CreatorField({ value, onChange, roomId }: CreatorFieldProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { roomUsers, customNames, refetchCustomNames } = useRoomMembers(roomId)

  // Sync external value when it changes (e.g. default user name loaded after auth)
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        commitValue()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inputValue, roomUsers])

  // Don't render for unauthenticated users
  if (!roomId) return null

  const query = inputValue.trim().toLowerCase()

  const filteredRoomUsers = query
    ? roomUsers.filter((u) => u.displayName.toLowerCase().includes(query))
    : roomUsers

  const filteredCustomNames = query
    ? customNames.filter((n) => n.toLowerCase().includes(query))
    : customNames

  const isRoomUser = (name: string) =>
    roomUsers.some((u) => u.displayName.toLowerCase() === name.toLowerCase())

  const isCustomName = (name: string) =>
    customNames.some((n) => n.toLowerCase() === name.toLowerCase())

  const commitValue = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onChange(trimmed)
    // Save as custom name if it's not already a room user or saved custom name
    if (!isRoomUser(trimmed) && !isCustomName(trimmed) && roomId) {
      saveCustomName(roomId, trimmed).then(() => refetchCustomNames())
    }
  }

  const selectUser = (member: RoomMember) => {
    setInputValue(member.displayName)
    onChange(member.displayName)
    setOpen(false)
  }

  const selectCustomName = (name: string) => {
    setInputValue(name)
    onChange(name)
    setOpen(false)
  }

  const showDropdown = open && (filteredRoomUsers.length > 0 || filteredCustomNames.length > 0)

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-[13px] text-section-header font-medium mb-1.5 pl-1">
        Автор
      </label>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.currentTarget.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            commitValue()
            setOpen(false)
          }, 150)
        }}
        placeholder="Имя автора..."
        className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
      />

      {showDropdown && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface rounded-xl shadow-lg border border-separator/30 py-1 z-50 max-h-56 overflow-y-auto">
          {filteredRoomUsers.length > 0 && (
            <>
              <div className="px-4 py-1 text-[11px] text-text-hint font-medium uppercase tracking-wide">
                Участники румы
              </div>
              {filteredRoomUsers.map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectUser(member)}
                  className="w-full px-4 py-2 text-left flex items-center gap-2.5 active:bg-primary/5 transition-colors"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-semibold text-primary">
                      {member.displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[14px] text-text">{member.displayName}</span>
                </button>
              ))}
            </>
          )}

          {filteredCustomNames.length > 0 && (
            <>
              {filteredRoomUsers.length > 0 && (
                <div className="mx-4 my-1 h-px bg-separator/30" />
              )}
              <div className="px-4 py-1 text-[11px] text-text-hint font-medium uppercase tracking-wide">
                Сохранённые имена
              </div>
              {filteredCustomNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectCustomName(name)}
                  className="w-full px-4 py-2 text-left active:bg-bg-secondary/50 transition-colors"
                >
                  <span className="text-[14px] text-text">{name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
