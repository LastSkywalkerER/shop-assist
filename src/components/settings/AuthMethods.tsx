import { useMemo, useState } from 'react'
import { TelegramLoginButton } from './TelegramLoginButton'
import { EmailAuthForm } from './EmailAuthForm'
import { GoogleAuthButton } from './GoogleAuthButton'

type Tab = 'telegram' | 'email' | 'google'

function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as { Telegram?: { WebApp?: { initData?: string } } }
  return !!w.Telegram?.WebApp?.initData
}

export function AuthMethods() {
  const miniApp = useMemo(isTelegramMiniApp, [])
  const [tab, setTab] = useState<Tab>(miniApp ? 'telegram' : 'telegram')

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 bg-separator/15 rounded-xl">
        <TabButton active={tab === 'telegram'} onClick={() => setTab('telegram')}>Telegram</TabButton>
        {!miniApp && (
          <>
            <TabButton active={tab === 'email'} onClick={() => setTab('email')}>Email</TabButton>
            <TabButton active={tab === 'google'} onClick={() => setTab('google')}>Google</TabButton>
          </>
        )}
      </div>

      {tab === 'telegram' && <TelegramLoginButton />}
      {tab === 'email' && !miniApp && <EmailAuthForm />}
      {tab === 'google' && !miniApp && <GoogleAuthButton mode="signin" />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors ${
        active ? 'bg-bg text-text shadow-sm' : 'text-text-hint'
      }`}
    >
      {children}
    </button>
  )
}
