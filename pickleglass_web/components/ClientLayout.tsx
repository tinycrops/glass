'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import SearchPopup from '@/components/SearchPopup'

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex h-screen">
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        onToggle={setIsSidebarCollapsed}
        onSearchClick={() => setIsSearchOpen(true)}
      />
      <main className="flex-1 overflow-auto bg-white">
        {children}
      </main>
      
      <SearchPopup 
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </div>
  )
} 