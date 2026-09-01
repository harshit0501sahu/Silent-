// Google Tasks API v1 — https://tasks.googleapis.com/tasks/v1
// Same fetch shape as sheetsApi.js, kept separate so this file has no
// dependency on it. err.status is attached so callers can tell "not signed
// in for this scope yet" (401/403) apart from a real network/API failure.

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

async function tasksFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Tasks API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function listTaskLists(token) {
  const data = await tasksFetch(`${TASKS_API}/users/@me/lists?maxResults=100`, token);
  return data.items || [];
}
async function createTaskList(token, title) {
  return tasksFetch(`${TASKS_API}/users/@me/lists`, token, { method: 'POST', body: JSON.stringify({ title }) });
}
async function deleteTaskList(token, listId) {
  await tasksFetch(`${TASKS_API}/users/@me/lists/${encodeURIComponent(listId)}`, token, { method: 'DELETE' });
}

async function listTasks(token, listId, showCompleted) {
  const params = new URLSearchParams({
    maxResults: '100',
    showCompleted: String(!!showCompleted),
    showHidden: String(!!showCompleted),
  });
  const data = await tasksFetch(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks?${params}`, token);
  return data.items || [];
}
async function insertTask(token, listId, task) {
  return tasksFetch(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, token, {
    method: 'POST', body: JSON.stringify(task),
  });
}
async function patchTask(token, listId, taskId, fields) {
  return tasksFetch(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, token, {
    method: 'PATCH', body: JSON.stringify(fields),
  });
}
async function deleteTask(token, listId, taskId) {
  await tasksFetch(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, token, {
    method: 'DELETE',
  });
}
async function clearCompletedTasks(token, listId) {
  await tasksFetch(`${TASKS_API}/lists/${encodeURIComponent(listId)}/clear`, token, { method: 'POST' });
}
