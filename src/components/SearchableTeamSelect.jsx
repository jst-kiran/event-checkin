import { useEffect, useRef, useState } from 'react'
import { Users, Search, Check, ChevronDown, X } from 'lucide-react'

export default function SearchableTeamSelect({
  label = 'TEAM NAME',
  teams = [],
  value = '',
  onChange,
  error = '',
  disabled = false,
  placeholder = 'Search or select your team...',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  // Normalize teams array into object shape [{ name, members: [] }]
  const normalizedTeams = teams.map((item) => {
    if (typeof item === 'string') {
      return { name: item, members: [] }
    }
    return {
      name: item.name || '',
      members: item.members || [],
    }
  })

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter teams by search query (checks team name AND member names)
  const filteredTeams = normalizedTeams.filter((team) => {
    const q = query.trim().toLowerCase()
    if (!q) return true

    const nameMatch = team.name.toLowerCase().includes(q)
    const memberMatch = team.members.some((m) => String(m).toLowerCase().includes(q))
    return nameMatch || memberMatch
  })

  const handleSelect = (teamName) => {
    onChange(teamName)
    setQuery('')
    setIsOpen(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
    if (inputRef.current) inputRef.current.focus()
  }

  const selectedTeamObj = normalizedTeams.find((t) => t.name === value)

  return (
    <div className="w-full text-left" ref={containerRef}>
      {label && (
        <label className="block text-[11px] font-bold tracking-[0.15em] text-slate-500 mb-2 uppercase">
          {label}
        </label>
      )}

      <div className="relative">
        {/* Left Search/Users Icon */}
        <Users
          className="w-5 h-5 text-purple-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
          aria-hidden="true"
        />

        {/* Combobox Trigger Input */}
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          value={isOpen ? query : value || ''}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true)
              setQuery('')
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!isOpen) setIsOpen(true)
          }}
          className={`w-full min-h-[3.5rem] pl-11 pr-10 rounded-2xl bg-purple-50/30 border border-purple-100 text-slate-900
            placeholder:text-slate-400 outline-none transition-all
            focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-500/10
            disabled:bg-slate-50 disabled:text-slate-500 cursor-pointer
            ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/10' : ''}`}
        />

        {/* Right Arrow / Clear Button */}
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && !isOpen && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 text-purple-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>

        {/* Dropdown Popover */}
        {isOpen && !disabled && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-purple-100/90 rounded-2xl shadow-xl shadow-purple-900/10 z-30 max-h-64 overflow-y-auto divide-y divide-slate-50 p-1.5">
            {filteredTeams.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400 text-center font-medium">
                No matching generated teams found
              </div>
            ) : (
              filteredTeams.map((team) => {
                const isSelected = team.name === value
                const memberListStr = team.members.join(', ')

                return (
                  <button
                    key={team.name}
                    type="button"
                    onClick={() => handleSelect(team.name)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-purple-50 border border-purple-100 text-purple-950 font-medium'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{team.name}</span>
                        {isSelected && (
                          <span className="text-[10px] bg-purple-200/60 text-purple-800 px-2 py-0.5 rounded-md font-semibold">
                            Selected
                          </span>
                        )}
                      </div>
                      {memberListStr && (
                        <p className="text-xs text-slate-500 truncate mt-0.5 leading-tight">
                          <span className="font-semibold text-slate-400">Members:</span>{' '}
                          {memberListStr}
                        </p>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-purple-600 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Selected Team Members Preview (When dropdown is closed) */}
      {selectedTeamObj && selectedTeamObj.members.length > 0 && !isOpen && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-purple-50/50 border border-purple-100/60 text-xs text-slate-600">
          <span className="font-semibold text-purple-700">Team Members:</span>{' '}
          {selectedTeamObj.members.join(', ')}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  )
}
