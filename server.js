// NEXPERT TechDesk — 기술 지원 Q&A 서버 (보안장비 · Azure · AWS)
//
// ── 배포 형태 ────────────────────────────────────────────────────────
//   ALB(443) → ECS Fargate 태스크(8080) → Bedrock(us-east-1)
//
// ⚠ **자격증명을 코드에도 환경변수에도 두지 않는다.** ECS 태스크에 붙인
//   IAM Task Role 을 AWS SDK 가 컨테이너 자격증명 체인으로 자동 해석한다.
//   AnthropicBedrockMantle 에 키 인자를 넘기는 순간 그 이점이 사라지므로 넘기지 않는다.

const express = require("express");
const path = require("path");
const { AnthropicBedrock } = require("@anthropic-ai/bedrock-sdk");
const { systemBlocks } = require("./src/grounding");
const categories = require("./src/categories");
const limits = require("./src/limits");

const PORT = Number(process.env.PORT || 8080);
// ECS 는 서울(ap-northeast-2)에서 돌지만 Bedrock 은 us-west-2 다.
// AWS_REGION 을 그대로 쓰면 서울로 요청이 가서 실패하므로 따로 받는다.
//
// ⚠ 서울(ap-northeast-2)로 바꾸지 마라. Claude 교차 리전 추론 할당량이 서울만 0 이다
//   (다른 리전은 30M). 지연시간이 아까워도 여기서는 답이 아예 안 온다.
const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-west-2";
// ⚠ `us.` 는 교차 리전 추론 프로파일 접두사다. 빼면 on-demand 를 못 찾아 실패한다.
//
// 왜 Opus 5 가 아니라 4.6 인가: 이 계정은 **최신 세대(Opus 5·Sonnet 5·Opus 4.8·4.7)만**
// 거절당한다 — "account history" 를 이유로 든 AWS 의 용량 배분이다. 4.6 이하는 정상
// 동작한다. 열리면 이 값만 `us.anthropic.claude-opus-5` 로 바꾸면 된다. README 참고.
const MODEL = process.env.BEDROCK_MODEL || "us.anthropic.claude-opus-4-6-v1";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 4096);
const MAX_HISTORY = 10;

// ── MCP 문서 조회 ───────────────────────────────────────────────────
// Azure·AWS 카테고리는 벤더가 운영하는 원격 MCP 서버로 공식 문서를 조회한다
// (src/categories.js 의 MCP 참조). **기본값은 꺼짐**이다.
//
// 왜 꺼두는가: 이 접점(bedrock-runtime)에서 MCP 커넥터가 동작하는지 아직 확인하지
// 못했다. 그동안은 모델 호출 자체가 막혀 검증할 수가 없었다. 켜둔 채로 두면 실패했을 때
// **"MCP가 안 되는 건지 모델이 안 열린 건지" 구분이 안 된다.**
// **먼저 일반 답변이 나오는 것을 확인하고, 그다음 이 값을 켜서 따로 검증한다.**
const MCP_ENABLED = process.env.MCP_ENABLED === "1";
const MCP_BETA = "mcp-client-2025-04-04";

// `bedrock-runtime` 에는 프로젝트(workspace) 개념이 없다. 예전 `bedrock-mantle` 접점이
// 요구하던 `BEDROCK_PROJECT_ID`·`anthropic-workspace-id` 헤더는 함께 지웠다.
const client = new AnthropicBedrock({ awsRegion: BEDROCK_REGION });

const app = express();
// ALB 뒤에 있다. 켜지 않으면 모든 요청의 IP 가 ALB 사설 IP 로 보여
// 레이트리밋이 전체 사용자에게 하나로 걸린다.
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));
// ⚠ 정적 파일에 no-cache 를 붙인다. '캐시 금지'가 아니라 **매번 재검증**이라,
// 안 바뀌었으면 304 로 끝나 비용은 거의 없다.
//
// 안 붙이면 브라우저가 index.html 은 새로 받고 app.js 는 캐시에서 꺼내 쓰는 조합이
// 생긴다. 실제로 배포 직후 옛 app.js 가 새 index.html 에 없는 요소를 찾다가
// "Cannot set properties of null" 로 화면 전체가 죽었다.
// **배포할 때마다 사용자에게 강력 새로고침을 요구할 수는 없다.**
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

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
