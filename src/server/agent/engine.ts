// WorkflowEngine: one orchestrated, typed, persistent workflow per agent run (no agent swarm).
// - every step persists its output and the run state, so work survives crashes/restarts
// - bounded retries with exponential backoff for transient model/network errors only
// - per-run budget, max model calls, step timeout, pause / resume / cancel / retry
// - approval gates: a step can pause the run until the user approves or rejects
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AgentTask } from "../../shared/schemas.js";
import type { Ctx } from "../context.js";
import { newId, now, parseJson } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { log } from "../lib/log.js";
import type { GenerateRequest, GenerateResult } from "../providers/model/types.js";
import { BudgetExceededError, ModelOutputError } from "../providers/model/types.js";
import { monthSpend, recordUsage } from "../services/usage.js";
import { audit } from "../services/audit.js";

export const MAX_MODEL_CALLS_PER_RUN = 40;
export const STEP_TIMEOUT_MS = 6 * 60_000;
const MAX_STEP_ATTEMPTS = 3;

export interface ApprovalRequest {
  message: string;
  payload: unknown; // what will be applied if approved — shown to the user
}

export interface StepContext<I, S> {
  ctx: Ctx;
  runId: string;
  brandId: string;
  input: I;
  state: S;
  /** Model call with budget enforcement + usage accounting. */
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
  /** Throws BudgetExceededError if the run/month budget or model-call cap is exhausted. */
  checkBudget(): void;
  /** Account for usage of a provider call made outside generate() (e.g. web search). */
  charge(purpose: string, provider: string, model: string, usage: GenerateResult<unknown>["usage"]): void;
  note(message: string): void; // user-visible progress note on the step
  isCancelled(): boolean;
}

export interface StepDef<I, S> {
  name: string;
  label: string;
  run(sc: StepContext<I, S>): Promise<void | { awaitApproval: ApprovalRequest }>;
  /** Called when the user approves this step's gate. Throwing keeps the run awaiting approval. */
  onApprove?(sc: StepContext<I, S>, approval: ApprovalRequest): Promise<void>;
}

export interface TaskDef<I, S> {
  task: AgentTask;
  input: z.ZodType<I>;
  initialState(input: I): S;
  steps: StepDef<I, S>[];
  output(state: S): unknown;
}

type AnyTask = TaskDef<any, any>;

export class WorkflowEngine {
  private tasks = new Map<string, AnyTask>();
  private executing = new Set<string>();
  private notes = new Map<string, string[]>();
  /** Override in tests to avoid real sleeps. */
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  constructor(private ctx: Ctx) {}

  register(def: AnyTask) {
    this.tasks.set(def.task, def);
  }
  taskNames() {
    return [...this.tasks.keys()];
  }

  /** Mark runs that were executing when the process stopped as interrupted (resumable). */
  recoverInterrupted() {
    const n = this.ctx.db.run("UPDATE agent_runs SET status = 'interrupted', error = 'Server restarted while this run was in progress. Resume to continue from the last completed step.', updated_at = ? WHERE status IN ('running','queued')", now()).changes;
    this.ctx.db.run("UPDATE agent_steps SET status = 'pending' WHERE status = 'running'");
    return Number(n);
  }

  create(task: string, rawInput: unknown, brandId: string | null): string {
    const def = this.tasks.get(task);
    if (!def) throw badRequest(`Unknown task "${task}"`);
    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) throw badRequest("Invalid task input", parsed.error.issues);
    const id = newId("run");
    const ts = now();
    const model = this.ctx.model();
    this.ctx.db.tx(() => {
      this.ctx.db.insert("agent_runs", {
        id, brand_id: brandId, task, input_json: parsed.data, status: "queued", current_step: 0, state_json: def.initialState(parsed.data),
        provider: model.live ? `${model.id}:${model.models.strong}` : "offline-scaffold", budget_usd: this.ctx.settings().runBudgetUsd, created_at: ts, updated_at: ts,
      });
      def.steps.forEach((s, ord) => this.ctx.db.insert("agent_steps", { id: newId("step"), run_id: id, ord, name: s.name, label: s.label, status: "pending" }));
    });
    return id;
  }

  /** Create and execute in the background. Returns immediately. */
  start(task: string, input: unknown, brandId: string | null): string {
    const id = this.create(task, input, brandId);
    void this.execute(id);
    return id;
  }

  async execute(runId: string): Promise<void> {
    if (this.executing.has(runId)) return;
    this.executing.add(runId);
    try {
      await this.loop(runId);
    } catch (e) {
      log.error("run crashed", { runId, error: (e as Error).message });
      this.ctx.db.update("agent_runs", runId, { status: "failed", error: `Internal error: ${(e as Error).message}`, updated_at: now(), finished_at: now() });
    } finally {
      this.executing.delete(runId);
    }
  }

  private loop = async (runId: string) => {
    const { db } = this.ctx;
    let run = this.row(runId);
    const def = this.tasks.get(run.task)!;
    const input = def.input.parse(parseJson(run.input_json, {}));
    const state = parseJson<any>(run.state_json, def.initialState(input));
    db.update("agent_runs", runId, { status: "running", error: "", control: "", updated_at: now() });

    for (let ord = run.current_step; ord < def.steps.length; ord++) {
      run = this.row(runId);
      if (run.control === "cancel") return this.finish(runId, "cancelled", "Cancelled by user.");
      if (run.control === "pause") {
        db.update("agent_runs", runId, { status: "paused", control: "", updated_at: now() });
        return;
      }
      const step = def.steps[ord];
      const stepRow = db.get("SELECT * FROM agent_steps WHERE run_id = ? AND ord = ?", runId, ord)!;
      let attempt = stepRow.attempts;
      // retry loop for transient errors
      for (;;) {
        attempt++;
        this.notes.set(stepRow.id, []);
        db.update("agent_steps", stepRow.id, { status: "running", attempts: attempt, started_at: now(), error: "" });
        const sc = this.stepContext(runId, run.brand_id, input, state, stepRow.id, step.name);
        try {
          const result = await withTimeout(step.run(sc), STEP_TIMEOUT_MS, `Step "${step.label}" timed out`);
          const notes = this.notes.get(stepRow.id) ?? [];
          if (result && "awaitApproval" in result) {
            db.tx(() => {
              db.update("agent_steps", stepRow.id, { status: "awaiting_approval", output_json: { notes, approval: result.awaitApproval } });
              db.update("agent_runs", runId, { status: "awaiting_approval", current_step: ord, state_json: state, updated_at: now() });
            });
            return;
          }
          db.tx(() => {
            db.update("agent_steps", stepRow.id, { status: "succeeded", output_json: { notes, summary: summarise(state, step.name) }, finished_at: now() });
            db.update("agent_runs", runId, { current_step: ord + 1, state_json: state, updated_at: now() });
          });
          break;
        } catch (e) {
          const err = e as Error;
          const transient = isTransient(err);
          const notes = this.notes.get(stepRow.id) ?? [];
          db.update("agent_steps", stepRow.id, { status: "failed", error: err.message.slice(0, 2000), output_json: { notes }, finished_at: now() });
          db.update("agent_runs", runId, { state_json: state, updated_at: now() });
          if (transient && attempt < MAX_STEP_ATTEMPTS && this.row(runId).control !== "cancel") {
            await this.sleep(1000 * 2 ** (attempt - 1));
            continue;
          }
          return this.finish(runId, "failed", `${step.label}: ${err.message}`);
        }
      }
    }
    db.update("agent_runs", runId, { output_json: def.output(state) });
    this.finish(runId, "succeeded", "");
  };

  private finish(runId: string, status: string, error: string) {
    const r = this.row(runId);
    this.ctx.db.update("agent_runs", runId, { status, error: error.slice(0, 2000), updated_at: now(), finished_at: now() });
    audit(this.ctx.db, { brandId: r.brand_id, entityType: "agent_run", entityId: runId, action: `run_${status}`, detail: { task: r.task, costUsd: r.cost_usd, error: error.slice(0, 300) }, actor: "agent" });
  }

  private stepContext(runId: string, brandId: string, input: unknown, state: unknown, stepId: string, stepName: string): StepContext<any, any> {
    const ctx = this.ctx;
    return {
      ctx,
      runId,
      brandId,
      input,
      state,
      note: (m) => this.notes.get(stepId)?.push(m.slice(0, 500)),
      isCancelled: () => this.row(runId).control === "cancel",
      checkBudget: () => this.checkBudget(runId),
      charge: (purpose, provider, modelId, usage) => this.charge(runId, brandId, stepName, provider, modelId, purpose, usage),
      generate: async <T,>(req: GenerateRequest<T>) => {
        const model = ctx.model();
        if (model.live) this.checkBudget(runId);
        const res = await model.generate(req);
        this.charge(runId, brandId, stepName, res.provider, res.model, req.purpose, res.usage);
        return res;
      },
    };
  }

  private checkBudget(runId: string) {
    const run = this.row(runId);
    if (run.model_calls >= MAX_MODEL_CALLS_PER_RUN) throw new BudgetExceededError(`Run reached the maximum of ${MAX_MODEL_CALLS_PER_RUN} model calls.`);
    if (run.cost_usd >= run.budget_usd) throw new BudgetExceededError(`Run budget of $${run.budget_usd.toFixed(2)} reached (spent ~$${run.cost_usd.toFixed(3)}). Raise it in Settings, then retry.`);
    const settings = this.ctx.settings();
    if (monthSpend(this.ctx.db) >= settings.monthlyBudgetUsd) throw new BudgetExceededError(`Monthly budget of $${settings.monthlyBudgetUsd} reached.`);
  }

  charge(runId: string, brandId: string | null, step: string, provider: string, modelId: string, purpose: string, usage: GenerateResult<unknown>["usage"]) {
    recordUsage(this.ctx.db, { brandId, runId, step, provider, model: modelId, purpose, usage });
    this.ctx.db.run(
      "UPDATE agent_runs SET cost_usd = cost_usd + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, model_calls = model_calls + ? WHERE id = ?",
      usage.costUsd, usage.inputTokens, usage.outputTokens, provider === "offline" ? 0 : 1, runId,
    );
  }

  private row(runId: string) {
    const r = this.ctx.db.get("SELECT * FROM agent_runs WHERE id = ?", runId);
    if (!r) throw notFound("Agent run");
    return r;
  }

  // ---------------- controls ----------------
  pause(runId: string) {
    const r = this.row(runId);
    if (r.status === "running" || r.status === "queued") this.ctx.db.update("agent_runs", runId, { control: "pause", updated_at: now() });
    else throw conflict(`Run is ${r.status}; only running runs can be paused.`);
    return this.get(runId);
  }
  cancel(runId: string) {
    const r = this.row(runId);
    if (["succeeded", "failed", "cancelled"].includes(r.status)) throw conflict(`Run already ${r.status}.`);
    if (r.status === "running" || r.status === "queued") this.ctx.db.update("agent_runs", runId, { control: "cancel", updated_at: now() });
    else this.finish(runId, "cancelled", "Cancelled by user.");
    return this.get(runId);
  }
  /** Resume a paused/interrupted run or retry a failed one from its failed step. Completed steps are not repeated. */
  resume(runId: string, wait = false) {
    const r = this.row(runId);
    if (!["paused", "interrupted", "failed"].includes(r.status)) throw conflict(`Run is ${r.status}; nothing to resume.`);
    if (r.status === "failed") {
      // A budget failure needs a budget change first; refresh the run's budget from current settings.
      this.ctx.db.update("agent_runs", runId, { budget_usd: Math.max(r.budget_usd, this.ctx.settings().runBudgetUsd) });
      this.ctx.db.run("UPDATE agent_steps SET attempts = 0 WHERE run_id = ? AND ord = ?", runId, r.current_step);
    }
    this.ctx.db.update("agent_runs", runId, { status: "queued", control: "", finished_at: null, updated_at: now() });
    const p = this.execute(runId);
    return wait ? p.then(() => this.get(runId)) : this.get(runId);
  }
  async decide(runId: string, decision: "approve" | "reject", note = "") {
    const r = this.row(runId);
    if (r.status !== "awaiting_approval") throw conflict("This run is not waiting for approval.");
    const def = this.tasks.get(r.task)!;
    const step = def.steps[r.current_step];
    const stepRow = this.ctx.db.get("SELECT * FROM agent_steps WHERE run_id = ? AND ord = ?", runId, r.current_step)!;
    const out = parseJson<any>(stepRow.output_json, {});
    audit(this.ctx.db, { brandId: r.brand_id, entityType: "agent_run", entityId: runId, action: decision === "approve" ? "gate_approved" : "gate_rejected", detail: { step: step.name, note } });
    if (decision === "reject") {
      this.ctx.db.update("agent_steps", stepRow.id, { status: "skipped", output_json: { ...out, decision: "rejected", note }, finished_at: now() });
      this.finish(runId, "cancelled", `Rejected at “${step.label}”${note ? `: ${note}` : ""}. Nothing was applied.`);
      return this.get(runId);
    }
    const input = def.input.parse(parseJson(r.input_json, {}));
    const state = parseJson<any>(r.state_json, {});
    const sc = this.stepContext(runId, r.brand_id, input, state, stepRow.id, step.name);
    try {
      await step.onApprove?.(sc, out.approval);
    } catch (e) {
      throw badRequest(`Could not apply: ${(e as Error).message}`);
    }
    this.ctx.db.tx(() => {
      this.ctx.db.update("agent_steps", stepRow.id, { status: "succeeded", output_json: { ...out, decision: "approved", note }, finished_at: now() });
      this.ctx.db.update("agent_runs", runId, { current_step: r.current_step + 1, state_json: state, status: "queued", updated_at: now() });
    });
    await this.execute(runId);
    return this.get(runId);
  }

  get(runId: string) {
    const r = dto(this.row(runId));
    return { ...r, steps: dtos(this.ctx.db.all("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY ord", runId)), running: this.executing.has(runId) };
  }
  list(brandId: string | null, limit = 50) {
    return dtos(this.ctx.db.all(`SELECT id, brand_id, task, status, current_step, cost_usd, model_calls, provider, error, created_at, updated_at, finished_at, (SELECT count(*) FROM agent_steps s WHERE s.run_id = r.id) AS step_count FROM agent_runs r ${brandId ? "WHERE brand_id = ?" : ""} ORDER BY created_at DESC LIMIT ${Math.min(limit, 200)}`, ...(brandId ? [brandId] : [])));
  }
}

function isTransient(e: Error): boolean {
  if (e instanceof BudgetExceededError || e instanceof ModelOutputError) return false;
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError) return e.status === 429 || e.status === 529 || (typeof e.status === "number" && e.status >= 500);
  return /timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(e.message);
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() => clearTimeout(t));
}

function summarise(state: any, stepName: string) {
  const s = state?.summaries?.[stepName];
  return typeof s === "string" ? s : undefined;
}
