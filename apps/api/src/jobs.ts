// agent_jobs: progreso en vivo y ejecución en segundo plano.
// Un job lo escribe un solo proceso: mantenemos progress en memoria y lo escribimos entero, serializado
// (sin carreras entre escrituras y sin RPC). Cada escritura es un UPDATE → evento Realtime en la app.
import { waitUntil } from '@vercel/functions';
import type { JobProgressLine, JobStatus } from '@build101/shared';
import type { Db } from './supabase';
import { dbError } from './errors';

export async function createJob(
  admin: Db,
  row: { kind: string; trip_id: string | null; user_id: string; firstLine: string },
): Promise<string> {
  const { data, error } = await admin
    .from('agent_jobs')
    .insert({
      kind: row.kind,
      trip_id: row.trip_id,
      user_id: row.user_id,
      status: 'queued' satisfies JobStatus,
      progress: [{ at: new Date().toISOString(), text: row.firstLine }],
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'agent_jobs');
  return data.id as string;
}

export type JobPatch = { status?: JobStatus; result?: unknown; error?: string | null };

export class JobProgress {
  readonly lines: JobProgressLine[];
  private chain: Promise<void> = Promise.resolve();
  private lastAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly admin: Db,
    readonly jobId: string,
    initial: JobProgressLine[] = [],
  ) {
    this.lines = [...initial];
  }

  /** Agrega una línea de progreso (no bloquea: se encola la escritura). */
  push(text: string): Promise<void> {
    this.lines.push({ at: new Date().toISOString(), text });
    this.lastAt = Date.now();
    return this.write({});
  }

  /** Cambia status/result/error (junto con el progreso actual). */
  set(patch: JobPatch): Promise<void> {
    return this.write(patch);
  }

  private write(patch: JobPatch): Promise<void> {
    const snapshot = [...this.lines];
    this.chain = this.chain.then(async () => {
      const { error } = await this.admin
        .from('agent_jobs')
        .update({ ...patch, progress: snapshot })
        .eq('id', this.jobId);
      if (error) console.error(`[jobs/${this.jobId}] no pude escribir el progreso:`, error.message);
    });
    return this.chain;
  }

  /** Heartbeat: si pasan `everyMs` sin novedades, escribe text() (PRD: al menos una línea cada 10 s). */
  startHeartbeat(text: () => string, everyMs = 10_000): void {
    this.stopHeartbeat();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastAt >= everyMs - 250) void this.push(text());
    }, Math.max(250, Math.floor(everyMs / 4)));
    // No retener el proceso por el timer (tests / dev).
    (this.timer as { unref?: () => void }).unref?.();
  }

  stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Espera a que se escriba todo lo encolado. */
  flush(): Promise<void> {
    return this.chain;
  }
}

/**
 * Corre una promesa después de responder: en Vercel la registra con waitUntil (la función sigue viva hasta
 * maxDuration); en local (node) no hay contexto de request y queda fire-and-forget.
 */
export function runInBackground(label: string, promise: Promise<unknown>): void {
  const p = promise.catch((err) => console.error(`[bg/${label}]`, err));
  try {
    waitUntil(p);
  } catch {
    // sin contexto de Vercel: alcanza con no esperar
  }
}
