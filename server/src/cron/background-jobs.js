const running = new Map();

// Unset values preserve the existing all-in-one service. To move jobs to a
// designated worker, set the same owner on all instances and a distinct id on each.
export const shouldRunBackgroundJob = (name, env = process.env) => {
  if (env.BACKGROUND_JOBS_ENABLED === 'false' || env[`${name.toUpperCase()}_JOB_ENABLED`] === 'false') return false;
  const owner = String(env.BACKGROUND_JOBS_OWNER || '').trim();
  return !owner || owner === String(env.BACKGROUND_JOBS_INSTANCE_ID || '').trim();
};

export const startBackgroundJob = (name, initialize, env = process.env) => {
  if (!shouldRunBackgroundJob(name, env)) return () => {};
  if (running.has(name)) return running.get(name);
  const cleanup = initialize();
  const stop = () => {
    if (running.get(name) !== stop) return;
    running.delete(name);
    cleanup?.();
  };
  running.set(name, stop);
  return stop;
};
