/**
 * At most one scan per key runs, and at most one more waits behind it.
 *
 * A caller always gets a result that started after it asked: a request that arrives while a scan is
 * running joins the single scan queued behind it, never the one already under way. So any number of
 * concurrent callers costs at most two scans and holds at most two results.
 *
 * Why (incident 2026-11-15): the workspace re-reads a project's file list after file events. A
 * game with ~9,500 files took 2 s per listing and ~7 MB of heap while it was built, an agent kept
 * writing files, and the daemon started one full listing per request. Listings in flight slowed
 * each other, more requests arrived than finished, and the daemon ran out of heap after 2.9 hours.
 */
export function createCoalescedScan<T>(): (key: string, scan: () => Promise<T>) => Promise<T> {
  const flights = new Map<string, { running: Promise<T> | null; queued: Promise<T> | null }>();
  const settle = () => {};

  const launch = (key: string, flight: { running: Promise<T> | null; queued: Promise<T> | null }, scan: () => Promise<T>): Promise<T> => {
    const running = Promise.resolve().then(scan);
    flight.running = running;
    void running.then(settle, settle).then(() => {
      if (flight.running === running) flight.running = null;
      if (!flight.running && !flight.queued && flights.get(key) === flight) flights.delete(key);
    });
    return running;
  };

  return (key, scan) => {
    let flight = flights.get(key);
    if (!flight) {
      flight = { running: null, queued: null };
      flights.set(key, flight);
    }
    const running = flight.running;
    if (!running) return launch(key, flight, scan);
    const current = flight;
    current.queued ??= running.then(settle, settle).then(() => {
      current.queued = null;
      return launch(key, current, scan);
    });
    return current.queued;
  };
}
