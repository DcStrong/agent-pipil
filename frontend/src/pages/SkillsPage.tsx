import { useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import type { Role, Skill } from '../types'

interface Draft {
  name: string
  instructions: string
  scope: 'shared' | 'role'
  roleId: string
}

const emptyDraft = (roleId: string): Draft => ({
  name: '',
  instructions: '',
  scope: 'shared',
  roleId,
})

export function SkillsPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft(''))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancel = false
    void Promise.all([api.roles(), api.skills()])
      .then(([nextRoles, nextSkills]) => {
        if (cancel) return
        setRoles(nextRoles)
        setSkills(nextSkills)
        setDraft((current) =>
          current.roleId ? current : emptyDraft(nextRoles[0]?.id ?? ''),
        )
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(messageOf(reason))
      })
    return () => {
      cancel = true
    }
  }, [])

  const shared = skills.filter((skill) => skill.scope === 'shared')
  const roleSkills = skills.filter((skill) => skill.scope === 'role')

  function edit(skill: Skill) {
    setEditingId(skill.id)
    setDraft({
      name: skill.name,
      instructions: skill.instructions,
      scope: skill.scope,
      roleId: skill.roleId ?? roles[0]?.id ?? '',
    })
    setError(null)
  }

  function resetForm() {
    setEditingId(null)
    setDraft(emptyDraft(roles[0]?.id ?? ''))
  }

  async function save() {
    setSaving(true)
    setError(null)
    const body = {
      name: draft.name,
      instructions: draft.instructions,
      scope: draft.scope,
      roleId: draft.scope === 'role' ? draft.roleId : null,
    }
    try {
      if (editingId) {
        const saved = await api.updateSkill(editingId, body)
        setSkills((current) => current.map((skill) => (skill.id === saved.id ? saved : skill)))
      } else {
        const created = await api.createSkill(body)
        setSkills((current) => [...current, created])
      }
      resetForm()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api.deleteSkill(id)
      setSkills((current) => current.filter((skill) => skill.id !== id))
      if (editingId === id) resetForm()
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <>
      <main className="page">
        <p className="crumb">Library</p>
        <div className="page-head">
          <h1>Skills</h1>
        </div>
        <p className="lede">
          Shared skills go to every role. Role skills stay with one agent. A run snapshots both when it starts.
        </p>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        <section className="skill-block">
          <h2>Shared library</h2>
          <ul className="card-list">
            {shared.map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  className={skill.id === editingId ? 'select-card is-selected' : 'select-card'}
                  onClick={() => edit(skill)}
                >
                  <strong>{skill.name}</strong>
                  <span>{skill.instructions}</span>
                </button>
              </li>
            ))}
          </ul>
          {shared.length === 0 ? <p className="hint">No shared skills yet.</p> : null}
        </section>
        <section className="skill-block">
          <h2>Role skills</h2>
          <ul className="card-list">
            {roleSkills.map((skill) => {
              const role = roles.find((item) => item.id === skill.roleId)
              return (
                <li key={skill.id}>
                  <button
                    type="button"
                    className={skill.id === editingId ? 'select-card is-selected' : 'select-card'}
                    onClick={() => edit(skill)}
                  >
                    <strong>{skill.name}</strong>
                    <span>
                      {role?.name ?? 'Missing role'} · {skill.instructions}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {roleSkills.length === 0 ? <p className="hint">No role skills yet.</p> : null}
        </section>
      </main>
      <aside className="sidebar">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <h2>{editingId ? 'Edit skill' : 'Add a skill'}</h2>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Instructions
            <textarea
              rows={6}
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </label>
          <fieldset>
            <legend>Where it applies</legend>
            <label className="choice">
              <input
                type="radio"
                name="scope"
                checked={draft.scope === 'shared'}
                onChange={() => setDraft({ ...draft, scope: 'shared' })}
              />
              Shared library
            </label>
            <label className="choice">
              <input
                type="radio"
                name="scope"
                checked={draft.scope === 'role'}
                onChange={() => setDraft({ ...draft, scope: 'role' })}
              />
              One role
            </label>
          </fieldset>
          {draft.scope === 'role' ? (
            <label>
              Role
              <select
                value={draft.roleId}
                onChange={(event) => setDraft({ ...draft, roleId: event.target.value })}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="row-actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save skill' : 'Add skill'}
            </button>
            {editingId ? (
              <button type="button" className="ghost" onClick={resetForm}>
                New skill
              </button>
            ) : null}
            {editingId ? (
              <button
                type="button"
                className="ghost danger"
                onClick={() => void remove(editingId)}
              >
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </aside>
    </>
  )
}
