import { useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import { firstSentence } from '../format'
import type { Role, Skill } from '../types'

interface Draft {
  name: string
  systemPrompt: string
}

export function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancel = false
    void Promise.all([api.roles(), api.skills()])
      .then(([nextRoles, nextSkills]) => {
        if (cancel) return
        setRoles(nextRoles)
        setSkills(nextSkills)
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(messageOf(reason))
      })
    return () => {
      cancel = true
    }
  }, [])

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0] ?? null
  const draft = selected
    ? (drafts[selected.id] ?? { name: selected.name, systemPrompt: selected.systemPrompt })
    : null
  const dirty = Boolean(
    selected &&
      draft &&
      (draft.name !== selected.name || draft.systemPrompt !== selected.systemPrompt),
  )
  const attached = skills.filter((skill) => skill.roleId === selected?.id)

  function updateDraft(patch: Partial<Draft>) {
    if (!selected || !draft) return
    setDrafts((current) => ({ ...current, [selected.id]: { ...draft, ...patch } }))
  }

  async function save() {
    if (!selected || !draft) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.updateRole(selected.id, draft)
      setRoles((current) => current.map((role) => (role.id === saved.id ? saved : role)))
      setDrafts((current) => {
        const next = { ...current }
        delete next[saved.id]
        return next
      })
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSaving(false)
    }
  }

  async function addRole() {
    setError(null)
    try {
      const created = await api.createRole({
        name: 'New role',
        systemPrompt: 'Describe what this role is responsible for, and what it should leave for the next one.',
      })
      setRoles((current) => [...current, created])
      setSelectedId(created.id)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function removeRole() {
    if (!selected) return
    setError(null)
    try {
      await api.deleteRole(selected.id)
      setRoles((current) => current.filter((role) => role.id !== selected.id))
      setSkills((current) => current.filter((skill) => skill.roleId !== selected.id))
      setSelectedId(null)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <>
      <main className="page">
        <p className="crumb">Agents</p>
        <div className="page-head">
          <h1>Roles</h1>
          <button type="button" className="primary" onClick={() => void addRole()}>
            Add role
          </button>
        </div>
        <p className="lede">
          Each role is an agent with a name and a system prompt. The pipeline assigns a stage to a role.
        </p>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="card-list">
          {roles.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                className={role.id === selected?.id ? 'select-card is-selected' : 'select-card'}
                onClick={() => setSelectedId(role.id)}
              >
                <strong>{role.name}</strong>
                <span>{firstSentence(role.systemPrompt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
      <aside className="sidebar">
        {selected && draft ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <h2>Role settings</h2>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>
            <label>
              System prompt
              <textarea
                rows={10}
                value={draft.systemPrompt}
                onChange={(event) => updateDraft({ systemPrompt: event.target.value })}
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="primary" disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save role'}
              </button>
              <button type="button" className="ghost danger" onClick={() => void removeRole()}>
                Delete
              </button>
            </div>
            {dirty ? <p className="hint">Unsaved changes stay on this role until you save.</p> : null}
            <section>
              <h3>Skills on this role</h3>
              {attached.length === 0 ? (
                <p className="hint">No role-specific skills yet. Add them on the Skills page.</p>
              ) : (
                <ul className="chip-list">
                  {attached.map((skill) => (
                    <li key={skill.id}>{skill.name}</li>
                  ))}
                </ul>
              )}
              <p className="hint">Shared skills are applied to every role, including this one.</p>
            </section>
          </form>
        ) : (
          <p className="hint">Add a role to give the pipeline another agent.</p>
        )}
      </aside>
    </>
  )
}
