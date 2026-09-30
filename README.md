# Pipil

A local board for one task moving through a pipeline of agents. You edit the roles, the skills, and the handoff order. The task moves from agent to agent while you watch, then the board shows the final result.

Agents are simulated, so the demo runs with no API keys.

## Run

Install once from the repository root (Node.js 22):

```bash
npm install
```

Start the frontend and the backend together:

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000/api/health

To run them in two terminals:

```bash
npm run start:backend
npm run start:frontend
```

Open the frontend. Send a task from the board. The card moves from analyst to architect to developer to reviewer, and the final result appears in the side panel when the run finishes.

Roles, skills, the pipeline, and run history are stored in `backend/data/state.json`. Delete that file to restore the seeded board.

## What you can edit

- **Roles.** Analyst, architect, developer, and reviewer are seeded. Each has a name and a system prompt. Add or rename roles on the Roles page.
- **Skills.** Shared skills are given to every role. Role skills stay with one role. Add either kind on the Skills page.
- **Pipeline.** Stages run in order. Every stage except the last has a handoff note: the instruction the next role receives.

Only one task runs at a time.

## Optional model

Leave `MODEL_API_KEY` unset and every role is simulated.

To call an OpenAI-compatible chat API instead, set these in the backend environment and restart it:

```bash
MODEL_API_KEY=your-key
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
```

`AGENT_MODE=simulated` forces the simulator even when a key is present. `AGENT_MODE=model` requires `MODEL_API_KEY`. See `backend/.env.example`.

## Tests

```bash
npm test
```
