import { useEffect, useRef, useState } from 'react';

// Optional URL history adapter; the component state remains local and ephemeral.
// The history entry carries only the step number, never personal information.
export function useDemoStep(flow, enabled = false) {
  const [step, update] = useState(0);
  const current = useRef(0);
  const run = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    run.current = `${flow}-${Date.now()}-${Math.random()}`;
    window.history.replaceState({ ...window.history.state, neulbomDemo: { run: run.current, step: 0 } }, '');
    const back = event => {
      const entry = event.state?.neulbomDemo;
      const next = entry?.run === run.current ? entry.step : 0;
      current.current = next;
      update(next);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [flow, enabled]);
  const setStep = value => {
    const next = typeof value === 'function' ? value(current.current) : value;
    if (enabled && next !== current.current) window.history.pushState({ ...window.history.state, neulbomDemo: { run: run.current, step: next } }, '');
    current.current = next;
    update(next);
  };
  return [step, setStep];
}
