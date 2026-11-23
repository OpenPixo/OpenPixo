/**
 * Games whose project should start running as soon as it opens: a finished
 * game made to be played right away, like the sample. Asked once, by this
 * window, for the project it is about to open.
 */
const waiting = new Set<string>();

export function queueProjectGameStart(projectId: string): void {
  waiting.add(projectId);
}

export function takeProjectGameStart(projectId: string): boolean {
  return waiting.delete(projectId);
}
