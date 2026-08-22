# Add Worker acceptance criteria

- Uses only saved sites and real workers from the backend.
- Requires a worker to be placed inside the selected site polygon before save.
- Persists Worker ID, team, role, task, work intensity, exposure context, shift, supervisor, status, notes, and coordinates.
- Shows verified FortyGuard site conditions when available and never invents missing provider values.
- Recently added workers are loaded from the selected site and update immediately after save.
- Existing SQLite databases migrate forward without deleting sites or workers.
