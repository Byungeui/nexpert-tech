// 넥스퍼트시스템즈 보안장비 기술 Q&A — 서버
//
// ── 배포 형태 ────────────────────────────────────────────────────────
//   ALB(443) → ECS Fargate 태스크(8080) → Bedrock(us-east-1)
//
// ⚠ **자격증명을 코드에도 환경변수에도 두지 않는다.** ECS 태스크에 붙인
//   IAM Task Role 을 AWS SDK 가 컨테이너 자격증명 체인으로 자동 해석한다.
//   AnthropicBedrockMantle 에 키 인자를 넘기는 순간 그 이점이 사라지므로 넘기지 않는다.

const express = require("express");
const path = require("path");
const { AnthropicBedrockMantle } = require("@anthropic-ai/bedrock-sdk");
const { systemBlocks } = require("./src/grounding");
const categories = require("./src/categories");
const limits = require("./src/limits");

const PORT = Number(process.env.PORT || 8080);
// ECS 는 서울(ap-northeast-2)에서 돌지만 Bedrock 은 us-east-1 이다.
// AWS_REGION 을 그대로 쓰면 서울로 요청이 가서 실패하므로 따로 받는다.
const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const PROJECT_ID = process.env.BEDROCK_PROJECT_ID;
const MODEL = process.env.BEDROCK_MODEL || "anthropic.claude-opus-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 4096);
const MAX_HISTORY = 10;

// ── MCP 문서 조회 ───────────────────────────────────────────────────
// Azure·AWS 카테고리는 벤더가 운영하는 원격 MCP 서버로 공식 문서를 조회한다
// (src/categories.js 의 MCP 참조). **기본값은 꺼짐**이다.
//
// 왜 꺼두는가: 이 접점(bedrock-mantle)에서 MCP 커넥터가 동작하는지 아직 확인하지
// 못했다. 모델 호출 자체가 계정 문제로 막혀 있어 검증할 수가 없었다. 켜둔 채로
// 두면 나중에 실패했을 때 **"MCP가 안 되는 건지 계정이 안 열린 건지" 구분이 안 된다.**
// 계정이 열려 일반 답변이 되는 것을 먼저 확인하고, 그다음 이 값을 켠다.
const MCP_ENABLED = process.env.MCP_ENABLED === "1";
const MCP_BETA = "mcp-client-2025-04-04";

if (!PROJECT_ID) {
  console.error("[fatal] BEDROCK_PROJECT_ID 가 없습니다 (콘솔의 anthropic-workspace-id).");
  process.exit(1);
}

const client = new AnthropicBedrockMantle({
  awsRegion: BEDROCK_REGION,
  defaultHeaders: { "anthropic-workspace-id": PROJECT_ID },
});

const app = express();
// ALB 뒤에 있다. 켜지 않으면 모든 요청의 IP 가 ALB 사설 IP 로 보여
// 레이트리밋이 전체 사용자에게 하나로 걸린다.
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── 헬스체크 ────────────────────────────────────────────────────────
// ALB 가 이 경로를 주기적으로 때린다. 실패하면 태스크를 죽이고 재시작하므로
// **Bedrock 호출이나 외부 의존을 절대 넣지 않는다.** Bedrock 이 잠깐 흔들렸다고
// 멀쩡한 태스크가 재시작 루프에 빠지면 안 된다.
app.get("/health", (_req, res) => res.status(200).send("ok"));

// 운영 확인용. 사용량이 얼마나 찼는지 본다.
app.get("/api/status", (_req, res) => res.json({ ...limits.status(), mcp: MCP_ENABLED }));

// 화면이 카테고리 목록을 여기서 받아 간다. **목록의 정본은 서버**다 —
// 화면에 하드코딩하면 규칙과 예시 질문이 따로 놀기 시작한다.
app.get("/api/categories", (_req, res) => res.json({
  categories: categories.forClient(),
  default: categories.DEFAULT_CATEGORY,
  mcp: MCP_ENABLED,
}));

app.post("/api/chat", async (req, res) => {
  const question = req.body?.question;
  const reason = limits.check(req, question);
  if (reason) return res.status(429).json({ error: reason });

  // 클라이언트가 보낸 카테고리를 그대로 믿지 않는다. 목록에 없으면 기본값이 된다.
  const category = categories.resolve(req.body?.category);

  // 대화 이력은 클라이언트가 보낸다. 그대로 믿으면 토큰 폭탄이 되므로
  // 길이와 개수를 서버에서 자른다.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const messages = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  messages.push({ role: "user", content: question });

  // SSE. 답변이 길어 한 번에 못 기다리므로 토큰을 흘려보낸다.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const params = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: systemBlocks(category.key),
      messages,
    };

    // MCP 를 쓰는 카테고리만 beta 경로로 보낸다. 안 쓰는 카테고리(SECUI)까지
    // beta 로 보내면, 문제가 생겼을 때 원인이 MCP 인지 beta 경로인지 갈린다.
    const useMcp = MCP_ENABLED && category.mcp;
    const stream = useMcp
      ? client.beta.messages.stream({ ...params, betas: [MCP_BETA], mcp_servers: category.mcp })
      : client.messages.stream(params);

    // 원시 이벤트를 직접 훑는다. text_delta 만 화면으로 보내면
    // 사고 과정(thinking_delta)은 자연히 걸러진다.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        send("delta", event.delta.text);
      } else if (event.type === "content_block_start" && event.content_block?.type === "mcp_tool_use") {
        // 문서를 조회하는 동안 화면이 멎어 보인다. 몇 초씩 걸리므로 무엇을 하는
        // 중인지 알려준다 — 안 그러면 사용자가 고장으로 여기고 새로고침한다.
        send("tool", event.content_block.server_name || "문서");
      }
    }

    const final = await stream.finalMessage();
    limits.record(final.usage);
    send("done", {
      cacheRead: final.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: final.usage?.cache_creation_input_tokens ?? 0,
      input: final.usage?.input_tokens ?? 0,
      output: final.usage?.output_tokens ?? 0,
    });
  } catch (e) {
    // 원인은 서버 로그에만 남긴다. 사용자에게 AWS 에러 원문을 보이면
    // 계정 번호나 역할 이름 같은 게 노출될 수 있다.
    console.error("[bedrock]", e?.name, e?.status, e?.message);
    send("error", "답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    res.end();
  }
});

const server = app.listen(PORT, () => {
  console.log(`nexpert-tech listening on ${PORT} · bedrock=${BEDROCK_REGION} · model=${MODEL}`);
});

// ECS 는 배포 교체 때 SIGTERM 을 보내고 기본 30초 뒤 SIGKILL 한다.
// 그 사이 진행 중인 응답을 마치고 내려간다.
process.on("SIGTERM", () => {
  console.log("SIGTERM — 종료합니다");
  server.close(() => process.exit(0));
});
