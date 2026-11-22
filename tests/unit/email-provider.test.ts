import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectEmailProvider } from "@/server/modules/email/provider";
import { describeSmtpError, gmailFromWarning, smtpProvider, smtpSecure, smtpSettings, verifySmtp } from "@/server/modules/email/smtp";
import { platformKeyDef } from "@/server/core/platform-secrets-catalog";

const base = { EMAIL_FROM: "Realy <no-reply@example.com>" };

describe("email provider selection", () => {
  it("keeps resend and postmark working", () => {
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "re_1234567890abc" })?.provider.id).toBe("resend");
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "postmark", EMAIL_API_KEY: "00000000-0000-0000-0000-000000000000" })?.provider.id).toBe("postmark");
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "resend" })).toBeNull();
  });

  it("selects smtp with a host (API key not needed)", () => {
    const r = selectEmailProvider({ ...base, EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "no-reply@example.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(r?.provider.id).toBe("smtp");
    expect(r?.from).toBe(base.EMAIL_FROM);
  });

  it("allows an IP-authenticated relay without credentials, never half-configured credentials", () => {
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp-relay.gmail.com" })?.provider.id).toBe("smtp");
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@example.com" })).toBeNull();
    expect(selectEmailProvider({ ...base, EMAIL_PROVIDER: "smtp" })).toBeNull();
    expect(selectEmailProvider({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.gmail.com" })).toBeNull();
  });

  it("derives implicit TLS from the port unless SMTP_SECURE says otherwise", () => {
    expect(smtpSecure(465)).toBe(true);
    expect(smtpSecure(587)).toBe(false);
    expect(smtpSecure(587, "true")).toBe(true);
    expect(smtpSecure(465, "false")).toBe(false);
    expect(smtpSettings({ SMTP_HOST: "smtp.gmail.com" })).toMatchObject({ port: 587, secure: false });
    expect(smtpSettings({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
  });

  it("strips the spaces Google shows in App Passwords", () => {
    expect(smtpSettings({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "u@example.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" })?.password).toBe("abcdefghijklmnop");
  });

  it("warns when the Gmail From address is not the authenticated user", () => {
    const s = smtpSettings({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "no-reply@example.com", SMTP_PASSWORD: "x" })!;
    expect(gmailFromWarning(s, "Realy <No-Reply@example.com>")).toBeNull();
    expect(gmailFromWarning(s, "Realy <hello@example.com>")).toMatch(/verified "Send mail as" alias/);
    const relay = smtpSettings({ SMTP_HOST: "smtp-relay.gmail.com", SMTP_USER: "no-reply@example.com", SMTP_PASSWORD: "x" })!;
    expect(gmailFromWarning(relay, "hello@example.com")).toBeNull();
  });

  it("explains a refused From address and bad credentials clearly", () => {
    const s = smtpSettings({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "u@example.com", SMTP_PASSWORD: "x" })!;
    expect(describeSmtpError({ responseCode: 553, command: "MAIL FROM", response: "553 5.7.1 Sender address rejected" }, s)).toMatch(/verified alias/);
    expect(describeSmtpError({ code: "EAUTH", responseCode: 535 }, s)).toMatch(/App Password/);
  });

  it("lists the SMTP settings as admin platform keys (password write-only)", () => {
    expect(platformKeyDef("SMTP_PASSWORD")?.kind).toBe("secret");
    expect(platformKeyDef("SMTP_HOST")?.testable).toBe(true);
    expect(platformKeyDef("EMAIL_PROVIDER")?.validate("smtp", () => undefined)).toBeNull();
  });
});

// ───────────── A minimal local SMTP server (no TLS, localhost only) ─────────────

interface Received {
  from: string;
  to: string[];
  data: string;
  auth: string | null;
}

function fakeSmtp(opts: { rejectFrom?: boolean } = {}): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((socket: Socket) => {
    let mail: Received = { from: "", to: [], data: "", auth: null };
    let inData = false;
    let buffer = "";
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 localhost fake ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(mail);
            mail = { from: "", to: [], data: "", auth: mail.auth };
            reply("250 2.0.0 queued as fake-1");
          } else mail.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        } else if (cmd.startsWith("AUTH PLAIN")) {
          mail.auth = Buffer.from(line.slice(11), "base64").toString("utf8").split("\0").slice(1).join(":");
          reply(mail.auth === "u@example.com:secret" ? "235 2.7.0 Authentication successful" : "535 5.7.8 Bad credentials");
        } else if (cmd.startsWith("MAIL FROM")) {
          mail.from = line.slice(10).trim();
          reply(opts.rejectFrom ? "553 5.7.1 Sender address rejected: not owned by user" : "250 OK");
        } else if (cmd.startsWith("RCPT TO")) {
          mail.to.push(line.slice(8).trim());
          reply("250 OK");
        } else if (cmd === "DATA") {
          inData = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else if (cmd === "RSET" || cmd === "NOOP") reply("250 OK");
        else reply("502 Command not implemented");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, received })));
}

describe("smtp delivery against a local fake server", () => {
  let ok: Awaited<ReturnType<typeof fakeSmtp>>;
  let rejecting: Awaited<ReturnType<typeof fakeSmtp>>;
  beforeAll(async () => {
    ok = await fakeSmtp();
    rejecting = await fakeSmtp({ rejectFrom: true });
  });
  afterAll(() => {
    ok.server.close();
    rejecting.server.close();
  });

  it("authenticates and delivers the message with headers", async () => {
    const s = smtpSettings({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(ok.port), SMTP_USER: "u@example.com", SMTP_PASSWORD: "secret" })!;
    expect((await verifySmtp(s, "u@example.com")).ok).toBe(true);
    const r = await smtpProvider(s).send({ from: "Realy <u@example.com>", to: "rcpt@example.org", subject: "Hello", text: "Plain body", html: "<p>Html body</p>", headers: { "List-Unsubscribe": "<https://example.com/u>" } });
    expect(r.messageId).toBeTruthy();
    const m = ok.received.at(-1)!;
    expect(m.from).toContain("u@example.com");
    expect(m.to[0]).toContain("rcpt@example.org");
    expect(m.data).toContain("Subject: Hello");
    expect(m.data).toContain("List-Unsubscribe: <https://example.com/u>");
    expect(m.auth).toBe("u@example.com:secret");
  });

  it("reports wrong credentials without sending", async () => {
    const s = smtpSettings({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(ok.port), SMTP_USER: "u@example.com", SMTP_PASSWORD: "wrong" })!;
    const v = await verifySmtp(s, null);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/rejected the username or password/);
  });

  it("surfaces a refused From address clearly", async () => {
    const s = smtpSettings({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(rejecting.port), SMTP_USER: "u@example.com", SMTP_PASSWORD: "secret" })!;
    await expect(smtpProvider(s).send({ from: "other@example.com", to: "rcpt@example.org", subject: "x", text: "x", html: "x" })).rejects.toThrow(/refused the From address/);
  });
});
