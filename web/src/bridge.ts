import type { SolverMessage } from './workers/protocol';
import './styles.css';
import { SOLVER_REVISION } from './model';

const run = document.querySelector<HTMLButtonElement>('#run')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const state = document.querySelector<HTMLElement>('#state')!;
const messages = document.querySelector<HTMLElement>('#messages')!;
const count = document.querySelector<HTMLOutputElement>('#count')!;
let worker: Worker | undefined;
let runId = 0;
let watchdog: ReturnType<typeof setTimeout>;
let heartbeat = 0;
let candidates: Extract<SolverMessage, { type: 'candidate' }>[] = [];
setInterval(() => { document.querySelector('#heartbeat')!.textContent = String(++heartbeat); }, 100);
document.querySelector<HTMLButtonElement>('#diagnostics')!.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ solverRevision: SOLVER_REVISION,
    seed: '42', state: state.textContent, candidates })], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sparrow-bridge-diagnostics.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function finish(reason: string) {
  worker?.postMessage({type:'stop'});
  worker = undefined;
  clearTimeout(watchdog);
  state.textContent = reason;
  run.disabled = false;
  stop.disabled = true;
}

stop.onclick = () => finish('Stopped');
run.onclick = async () => {
  const id = ++runId;
  run.disabled = true;
  stop.disabled = false;
  state.textContent = 'Initializing';
  messages.textContent = '';
  candidates = [];
  count.value = '0';
  watchdog = setTimeout(() => finish('Error: initialization exceeded 15 seconds'), 15_000);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}examples/swim.json`);
    if (!response.ok) throw new Error(`Example load failed: ${response.status}`);
    const input = await response.text();
    if (id !== runId || !run.disabled) return;
    worker = new Worker(new URL('./workers/solver.worker.ts', import.meta.url), { type: 'module' });
    let searchStarted = false;
    worker.onmessage = ({ data }: MessageEvent<SolverMessage>) => {
      if (!worker || data.runId !== runId || data.documentRevision !== 1) return;
      if (data.type === 'live') return;
      if (data.type === 'phase') {
        state.textContent = 'Running';
        if (!searchStarted) {
          searchStarted = true;
          clearTimeout(watchdog);
          // Native deadlines are cooperative; allow a final search iteration and export on slower CPUs.
          watchdog = setTimeout(() => finish('Stopped: solve watchdog'), 22_000);
        }
      }
      if (data.type === 'candidate') {
        candidates.push(data);
        count.value = String(candidates.length);
        messages.textContent += `Candidate ${data.sequence}: ${data.solution.layout.placed_items.length} copies, length ${data.solution.strip_width}, ${data.elapsedMs.toFixed(0)} ms\n`;
      } else {
        messages.textContent += `${JSON.stringify(data)}\n`;
      }
      if (data.type === 'finished') finish('Complete');
      if (data.type === 'error') finish(`Error: ${data.message}`);
    };
    worker.onerror = (event) => finish(`Error: ${event.message}`);
    worker.postMessage({ type: 'bridge', runId: id, documentRevision: 1, input, seed: '42', seconds: 10 });
  } catch (error) {
    if (id === runId) finish(`Error: ${String(error)}`);
  }
};
