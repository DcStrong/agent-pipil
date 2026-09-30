import { useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import type { PipelineStage, Role } from '../types'

const defaultHandoff =
  'Pass your notes, open questions, and what the next role should do.'

function withHandoffs(stages: PipelineStage[]): PipelineStage[] {
  return stages.map((stage, index) => {
    const isLast = index === stages.length - 1
    if (!isLast && stage.handoffInstruction.trim() === '') {
      return { ...stage, handoffInstruction: defaultHandoff }
    }
    return stage
  })
}

export function PipelinePage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancel = false
    void Promise.all([api.roles(), api.pipeline()])
      .then(([nextRoles, nextStages]) => {
        if (cancel) return
        setRoles(nextRoles)
        setStages(nextStages)
        setReady(true)
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(messageOf(reason))
      })
    return () => {
      cancel = true
    }
  }, [])

  const selectedIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === selectedId),
  )
  const selected = stages[selectedIndex] ?? null

  async function save(next: PipelineStage[], selectId?: string) {
    setError(null)
    try {
      const saved = await api.savePipeline(next)
      setStages(saved)
      if (selectId) setSelectedId(selectId)
    } catch (reason) {
      setError(messageOf(reason))
      try {
        setStages(await api.pipeline())
      } catch {
        // Keep the banner from the first failure.
      }
    }
  }

  async function addStage() {
    const roleId = roles[0]?.id
    if (!roleId) {
      setError('Add a role before adding a stage.')
      return
    }
    const created: PipelineStage = {
      id: '',
      roleId,
      handoffInstruction: '',
    }
    await save(withHandoffs([...stages, created]))
  }

  function move(direction: -1 | 1) {
    if (!selected) return
    const target = selectedIndex + direction
    if (target < 0 || target >= stages.length) return
    const next = [...stages]
    const [item] = next.splice(selectedIndex, 1)
    if (!item) return
    next.splice(target, 0, item)
    void save(withHandoffs(next), item.id)
  }

  function removeStage() {
    if (!selected) return
    if (stages.length === 1) {
      setError('The pipeline needs at least one stage.')
      return
    }
    const next = stages.filter((stage) => stage.id !== selected.id)
    setSelectedId(null)
    void save(withHandoffs(next))
  }

  return (
    <>
      <main className="page">
        <p className="crumb">Workflow / Delivery</p>
        <div className="page-head">
          <h1>Pipeline</h1>
          <button type="button" className="primary" onClick={() => void addStage()} disabled={!ready}>
            Add stage
          </button>
        </div>
        <p className="lede">
          Order is the handoff. Each note is what the next role receives with the task.
        </p>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        <div className="canvas" aria-label="Pipeline order">
          <div className="marker">
            <span className="dot" />
            <span>Start</span>
          </div>
          {stages.map((stage, index) => {
            const role = roles.find((item) => item.id === stage.roleId)
            return (
              <div className="canvas-step" key={stage.id}>
                {index > 0 ? (
                  <div className="route" title={stages[index - 1]?.handoffInstruction}>
                    <span>Handoff</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={stage.id === selected?.id ? 'step is-selected' : 'step'}
                  onClick={() => setSelectedId(stage.id)}
                >
                  <span className="eyebrow">Stage {index + 1}</span>
                  <strong>{role?.name ?? 'Missing role'}</strong>
                  {index < stages.length - 1 ? (
                    <em>{stage.handoffInstruction}</em>
                  ) : (
                    <em>Produces the final result.</em>
                  )}
                </button>
              </div>
            )
          })}
          <div className="route">
            <span>End</span>
          </div>
          <div className="marker">
            <span className="dot" />
            <span>End</span>
          </div>
        </div>
      </main>
      <aside className="sidebar">
        {selected ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
            }}
          >
            <h2>Stage {selectedIndex + 1}</h2>
            <label>
              Role
              <select
                value={selected.roleId}
                onChange={(event) => {
                  const roleId = event.target.value
                  const next = stages.map((stage) =>
                    stage.id === selected.id ? { ...stage, roleId } : stage,
                  )
                  void save(next, selected.id)
                }}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedIndex < stages.length - 1 ? (
              <label>
                Handoff to the next role
                <textarea
                  rows={5}
                  value={selected.handoffInstruction}
                  onChange={(event) => {
                    const handoffInstruction = event.target.value
                    setStages((current) =>
                      current.map((stage) =>
                        stage.id === selected.id ? { ...stage, handoffInstruction } : stage,
                      ),
                    )
                  }}
                  onBlur={() => {
                    void save(stages, selected.id)
                  }}
                />
              </label>
            ) : (
              <p className="hint">The last stage does not hand work onward. Its output is the final result.</p>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="ghost"
                disabled={selectedIndex === 0}
                onClick={() => move(-1)}
              >
                Move earlier
              </button>
              <button
                type="button"
                className="ghost"
                disabled={selectedIndex === stages.length - 1}
                onClick={() => move(1)}
              >
                Move later
              </button>
              <button type="button" className="ghost danger" onClick={removeStage}>
                Remove
              </button>
            </div>
          </form>
        ) : (
          <p className="hint">Select a stage to change its role or handoff.</p>
        )}
      </aside>
    </>
  )
}
