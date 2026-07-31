type Input = {
  config: string;
  cpu: string;
  gpu: string;
  vram: number;
  headset: string;
  goal: "smooth" | "balanced" | "visuals";
  session: string;
};

type ProposedChange = {
  line: number;
  setting: string;
  from: string;
  to: string;
  reason: string;
  impact: "CPU" | "GPU" | "VRAM" | "VR";
};

const allowedValue = /^-?\d+(?:\.\d+)?$/;

function validateChanges(config: string, changes: ProposedChange[]) {
  const lines = config.split(/\r?\n/);
  const seen = new Set<number>();
  return changes.filter((change) => {
    if (!Number.isInteger(change.line) || change.line < 0 || change.line >= lines.length || seen.has(change.line)) return false;
    if (!allowedValue.test(change.from) || !allowedValue.test(change.to)) return false;
    const line = lines[change.line];
    const numeric = line.match(/(-?\d+(?:\.\d+)?)\s*$/)?.[1];
    if (numeric !== change.from) return false;
    if (/InstalledPackagesPath|Adapter|Version/i.test(line)) return false;
    seen.add(change.line);
    return true;
  }).slice(0, 12);
}

async function safetyId(session: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.slice(0, 128)));
  return `ft_${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "AI optimization is not configured." }, { status: 503 });

  let body: Input;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!body.config || body.config.length > 80_000) {
    return Response.json({ error: "Config must be between 1 and 80,000 characters." }, { status: 400 });
  }

  const numberedConfig = body.config.split(/\r?\n/).map((line, index) => `${index}: ${line}`).join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      reasoning: { effort: "low" },
      safety_identifier: await safetyId(body.session || "anonymous"),
      instructions: [
        "You are a conservative Microsoft Flight Simulator 2024 configuration reviewer.",
        "Propose a small set of performance changes for the supplied UserCfg.opt based on the hardware and goal.",
        "Only propose changing the final numeric value on an existing numbered line. Never invent a key, add or delete a line, change syntax, paths, adapter names, versions, or non-numeric values.",
        "Prefer stable frame times over extreme settings. Treat VR as a per-eye rendering workload. If uncertain, omit the change.",
        "Return zero changes when no safe existing numeric settings can be identified.",
      ].join(" "),
      input: `Hardware: CPU ${body.cpu}; GPU ${body.gpu}; VRAM ${body.vram} GB; display ${body.headset}; goal ${body.goal}.\n\nNumbered configuration:\n${numberedConfig}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "msfs_config_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              changes: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    line: { type: "integer" },
                    setting: { type: "string" },
                    from: { type: "string" },
                    to: { type: "string" },
                    reason: { type: "string" },
                    impact: { type: "string", enum: ["CPU", "GPU", "VRAM", "VR"] },
                  },
                  required: ["line", "setting", "from", "to", "reason", "impact"],
                },
              },
            },
            required: ["summary", "changes"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("OpenAI response error", response.status, message.slice(0, 500));
    return Response.json({ error: "AI optimization is temporarily unavailable." }, { status: 502 });
  }

  const data = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const outputText = data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) return Response.json({ error: "No optimization plan returned." }, { status: 502 });

  const parsed = JSON.parse(outputText) as { summary: string; changes: ProposedChange[] };
  return Response.json({ engine: "AI", summary: parsed.summary, changes: validateChanges(body.config, parsed.changes) });
}
