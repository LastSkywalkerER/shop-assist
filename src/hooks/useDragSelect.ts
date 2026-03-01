import { useEffect, useCallback } from 'react'

/**
 * When selection mode is entered via long-press, allows user to drag finger/mouse over items
 * to add them to selection without lifting (like Telegram).
 */
export function useDragSelect(
  selectionMode: boolean,
  addToSelection: (id: string) => void,
  dataAttribute: string,
) {
  const addAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY)
      const row = el?.closest(`[${dataAttribute}]`)
      const id = row?.getAttribute(dataAttribute)
      if (id) addToSelection(id)
    },
    [addToSelection, dataAttribute],
  )

  useEffect(() => {
    if (!selectionMode) return

    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.setProperty('-webkit-user-select', 'none')

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return
      e.preventDefault()
      addAtPoint(e.touches[0].clientX, e.touches[0].clientY)
    }

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove, { capture: true })
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (e.buttons !== 0) addAtPoint(e.clientX, e.clientY)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.body.style.userSelect = prevUserSelect
      document.body.style.removeProperty('-webkit-user-select')
      document.removeEventListener('touchmove', handleTouchMove, { capture: true })
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [selectionMode, addAtPoint])
}
