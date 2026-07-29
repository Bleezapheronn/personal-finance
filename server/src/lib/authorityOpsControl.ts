import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const MAX_MESSAGE_BYTES = 1024;
export const controlPathForProfile = (profilePath: string) => `${path.resolve(profilePath)}.run.json`;
export const authorityProfileIdentity = (profilePath: string) => createHash("sha256").update(path.resolve(profilePath)).digest("hex");
export interface ControlDescriptor { version: 1; profileIdentity: string; sessionId: string; pipeName: string; controlToken: string; supervisorProcessId: number; createdAt: string; }
const validDescriptor = (value: unknown, profilePath: string): value is ControlDescriptor => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.version === 1 && input.profileIdentity === authorityProfileIdentity(profilePath) &&
    typeof input.sessionId === "string" && /^[a-f0-9]{32,}$/i.test(input.sessionId) &&
    typeof input.pipeName === "string" && input.pipeName.startsWith("\\\\.\\pipe\\personal-finance-") &&
    typeof input.controlToken === "string" && /^[A-Za-z0-9_-]{40,}$/.test(input.controlToken) &&
    Number.isInteger(input.supervisorProcessId) && typeof input.createdAt === "string";
};
const readDescriptor = (profilePath: string): ControlDescriptor => {
  try {
    const value = JSON.parse(readFileSync(controlPathForProfile(profilePath), "utf8")) as unknown;
    if (!validDescriptor(value, profilePath)) throw new Error();
    return value;
  } catch { throw new Error("supervisor_control_invalid"); }
};
const matches = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const writeDescriptorExclusive = (descriptorPath: string, descriptor: ControlDescriptor): void => {
  let handle: number | undefined;
  try {
    handle = openSync(descriptorPath, "wx", 0o600);
    writeFileSync(handle, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === "EEXIST" ? "supervisor_control_descriptor_exists" : "supervisor_control_descriptor_create_failed");
  } finally { if (handle !== undefined) closeSync(handle); }
};

export interface AuthorityOpsControlServer {
  descriptor: ControlDescriptor;
  /** Stop accepting control requests. Descriptor removal is a separate checked stage. */
  close: () => Promise<void>;
  /** Remove this server's descriptor, then prove that it is absent. */
  removeDescriptor: () => void;
}

export const createAuthorityOpsControlServer = async (options: { profilePath: string; sessionId: string; onStop: () => void }): Promise<AuthorityOpsControlServer> => {
  const profileIdentity = authorityProfileIdentity(options.profilePath);
  const descriptorPath = controlPathForProfile(options.profilePath);
  if (existsSync(descriptorPath)) {
    // A descriptor is evidence of a session.  Never infer that it is safe to
    // overwrite from a PID or an unavailable pipe.
    try { readDescriptor(options.profilePath); } catch { throw new Error("supervisor_control_invalid"); }
    throw new Error("supervisor_control_active");
  }
  const descriptor: ControlDescriptor = { version: 1, profileIdentity, sessionId: options.sessionId, pipeName: `\\\\.\\pipe\\personal-finance-${profileIdentity.slice(0, 12)}-${randomBytes(18).toString("hex")}`, controlToken: randomBytes(32).toString("base64url"), supervisorProcessId: process.pid, createdAt: new Date().toISOString() };
  let accepting = true; let stopped = false;
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let chunks: Buffer[] = []; let size = 0; let handled = false;
    socket.on("error", () => undefined);
    const reject = () => { if (!handled) { handled = true; socket.end('{"version":1,"ok":false}\n'); } };
    socket.setTimeout(2_000, reject);
    const handle = () => {
      if (handled) return;
      let value: unknown;
      const message = Buffer.concat(chunks).toString("utf8");
      if (!message.endsWith("\n") || message.slice(0, -1).includes("\n")) { reject(); return; }
      try { value = JSON.parse(message.slice(0, -1)); } catch { reject(); return; }
      if (!value || typeof value !== "object" || Array.isArray(value)) { reject(); return; }
      const request = value as Record<string, unknown>;
      const exact = ["version", "action", "profileIdentity", "sessionId", "controlToken"];
      if (Object.keys(request).length !== exact.length || !exact.every((key) => key in request) || request.version !== 1 || request.action !== "stop" ||
          request.profileIdentity !== descriptor.profileIdentity || request.sessionId !== descriptor.sessionId || typeof request.controlToken !== "string" || !matches(request.controlToken, descriptor.controlToken) || !accepting) { reject(); return; }
      handled = true; accepting = false; stopped = true; socket.end('{"version":1,"ok":true}\n'); options.onStop();
    };
    socket.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_MESSAGE_BYTES) { reject(); socket.destroy(); return; } chunks.push(chunk); if (Buffer.concat(chunks).includes(10)) handle(); });
    socket.on("end", () => { if (!handled) reject(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(descriptor.pipeName, () => resolve()); });
  try { writeDescriptorExclusive(descriptorPath, descriptor); }
  catch (error) { await new Promise<void>((resolve) => server.close(() => resolve())); throw error; }
  try { chmodSync(descriptorPath, 0o600); } catch { /* Windows ACLs are inherited; never relax access. */ }
  let closed = false;
  return { descriptor, close: async () => {
    if (closed) return;
    closed = true;
    accepting = false;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    void stopped;
  }, removeDescriptor: () => {
    if (!existsSync(descriptorPath)) return;
    const current = readDescriptor(options.profilePath);
    if (current.sessionId !== descriptor.sessionId || !matches(current.controlToken, descriptor.controlToken)) {
      throw new Error("authority_control_descriptor_not_owned");
    }
    unlinkSync(descriptorPath);
    if (existsSync(descriptorPath)) throw new Error("authority_control_descriptor_still_present");
  } };
};

export const requestAuthorityOpsStop = async (profilePath: string): Promise<void> => {
  const descriptorPath = controlPathForProfile(profilePath);
  if (!existsSync(descriptorPath)) throw new Error("supervisor_not_running");
  const descriptor = readDescriptor(profilePath);
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ path: descriptor.pipeName, allowHalfOpen: true }); let response = ""; let settled = false;
    const fail = (code: string) => { if (!settled) { settled = true; socket.destroy(); reject(new Error(code)); } };
    socket.setTimeout(2_000, () => fail("supervisor_control_timeout"));
    socket.once("error", () => fail("supervisor_control_unavailable"));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); if (response.length > MAX_MESSAGE_BYTES) fail("supervisor_control_rejected"); });
    socket.once("connect", () => socket.end(`${JSON.stringify({ version: 1, action: "stop", profileIdentity: descriptor.profileIdentity, sessionId: descriptor.sessionId, controlToken: descriptor.controlToken })}\n`));
    socket.once("end", () => { if (settled) return; try { const ack = JSON.parse(response) as { version?: unknown; ok?: unknown }; if (ack.version !== 1 || ack.ok !== true) return fail("supervisor_control_rejected"); settled = true; resolve(); } catch { fail("supervisor_control_rejected"); } });
  });
};
