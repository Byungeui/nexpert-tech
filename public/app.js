// 채팅 화면.
//
// 마크다운은 라이브러리를 쓰지 않고 최소한만 직접 그린다 — 표·코드·목록·강조.
// 답변에 표를 쓰라고 시스템 프롬프트에서 지시하므로 표는 반드시 필요하다.
// ⚠ 반드시 escape 를 먼저 하고 그 뒤에 마크업을 넣는다. 순서가 바뀌면 XSS 다.

const log = document.getElementById("log");
const form = document.getElementById("form");
const q = document.getElementById("q");
const sendBtn = document.getElementById("send");
const tabs = document.getElementById("tabs");
const examples = document.getElementById("examples");

// 대화 이력은 카테고리마다 따로 둔다. 보안장비 이야기를 하다 Azure 탭으로 옮겼는데
// 앞의 대화가 그대로 따라가면, 서버가 갈아 끼운 규칙과 이력이 어긋나 답이 흐려진다.
let history = [];
let current = null;      // 지금 선택된 카테고리 객체
let catalog = [];        // 서버가 준 카테고리 목록
let mcpOn = false;
let busy = false;

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function render(md) {
  const lines = esc(md).split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // 표 — | 로 시작하고 다음 줄이 구분선일 때만
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        "<table><thead><tr>" + head.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>"
      );
      continue;
    }

    // 목록
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 제목
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = Math.min(h[1].length + 2, 6);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // 문단 — 빈 줄까지 모은다
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*[-*]\s+|^\s*\||^```|^#{1,4}\s/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    // ⚠ **여기서 한 줄도 못 먹으면 i 가 안 늘어 바깥 while 이 영원히 돈다.**
    // 위 조건은 `|` 로 시작하는 줄을 제외하는데, 표 분기는 "다음 줄이 구분선일 때만"
    // 성립한다. 스트리밍 중에는 `| 항목 | 값 |` 까지만 오고 구분선은 아직 안 온다 —
    // 그 한 틱 동안 두 분기가 서로 미루며 out 이 배열 한계까지 커져
    // `RangeError: Invalid array length` 로 화면이 죽는다. 답변이 제대로 오는
    // 순간에만 터지므로, 모델이 막혀 있던 동안에는 드러나지 않았다.
    // **무슨 줄이든 최소 한 줄은 소비한다** — 이 한 줄이 진행을 보장한다.
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join("<br>"))}</p>`);
  }
  return out.join("");
}

function bubble(role) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const body = document.createElement("div");
  body.className = "body";
  wrap.appendChild(body);
  log.appendChild(wrap);
  wrap.scrollIntoView({ behavior: "smooth", block: "end" });
  return body;
}

async function ask(question) {
  if (busy || !question.trim()) return;
  busy = true;
  sendBtn.disabled = true;
  // 대화가 시작되면 목록을 위에서부터 채운다 (style.css 의 .started 참고)
  document.body.classList.add("started");

  bubble("user").textContent = question;
  const body = bubble("bot");
  body.className = "body typing";

  let answer = "";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history, category: current?.key }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `요청이 거절되었습니다 (${res.status})`);
    }

    // SSE 파싱. 이벤트는 빈 줄로 구분된다.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        const ev = chunk.match(/^event: (.+)$/m)?.[1];
        const raw = chunk.match(/^data: (.*)$/m)?.[1];
        if (!ev || raw === undefined) continue;
        const data = JSON.parse(raw);

        if (ev === "delta") {
          answer += data;
          body.className = "body typing";
          body.innerHTML = render(answer);
          log.lastElementChild.scrollIntoView({ block: "end" });
        } else if (ev === "tool") {
          // 문서 조회는 몇 초씩 걸린다. 그동안 화면이 멎어 보이지 않게 표시한다.
          body.className = "body";
          body.innerHTML = `<div class="tool">${esc(data)} 공식 문서를 찾는 중…</div>`;
        } else if (ev === "error") {
          throw new Error(data);
        }
      }
    }

    if (!answer) throw new Error("빈 응답을 받았습니다.");
    history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (e) {
    body.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  } finally {
    body.className = "body";
    busy = false;
    sendBtn.disabled = false;
    q.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = q.value;
  q.value = "";
  q.style.height = "auto";
  ask(text);
});

// Enter 전송 / Shift+Enter 줄바꿈
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// 입력 높이 자동 조절
q.addEventListener("input", () => {
  q.style.height = "auto";
  q.style.height = Math.min(q.scrollHeight, 180) + "px";
});

examples.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") ask(e.target.textContent);
});

// ── 카테고리 ──────────────────────────────────────────────────────
//
// 목록의 정본은 서버(src/categories.js)다. 여기에 옮겨 적지 않는다 —
// 화면의 예시 질문과 서버의 답변 규칙이 따로 놀기 시작하는 순간 이 사이트는
// "무엇을 물어야 하는지"를 잘못 안내하게 된다.

function select(key) {
  const cat = catalog.find((c) => c.key === key);
  if (!cat || cat === current) return;
  current = cat;
  history = [];               // 카테고리가 바뀌면 이력도 버린다
  log.replaceChildren();
  document.body.classList.remove("started");   // 다시 '시작 전' 배치로

  for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.key === key));

  // 안내 카드는 대화 목록의 첫 항목이다. 말풍선이 아니라 카드로 그린다 —
  // 답변이 아니라 "이 탭이 무엇을 근거로 답하는가"를 알리는 안내이기 때문이다.
  const badge = cat.key !== "secui" && mcpOn ? '<span class="badge">문서 조회</span>' : "";
  const card = document.createElement("div");
  card.className = "card intro";
  card.innerHTML =
    `<h2>${esc(cat.label)}<span style="color:var(--dim);font-weight:400"> · ${esc(cat.tagline)}</span>${badge}</h2>` +
    `<ul class="scope">${cat.intro.map(([t, d]) => `<li><b>${esc(t)}</b> — ${esc(d)}</li>`).join("")}</ul>` +
    `<p class="note">${esc(cat.note)}</p>`;
  log.appendChild(card);

  // 예시 질문
  examples.replaceChildren(...cat.examples.map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t;
    return b;
  }));

  q.focus();
}

(async function init() {
  try {
    const r = await fetch("/api/categories");
    if (!r.ok) throw new Error(`카테고리를 불러오지 못했습니다 (${r.status})`);
    const d = await r.json();
    catalog = d.categories;
    mcpOn = !!d.mcp;

    tabs.replaceChildren(...catalog.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.key = c.key;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", "false");
      b.innerHTML = `${esc(c.label)}<small>${esc(c.tagline)}</small>`;
      b.addEventListener("click", () => select(c.key));
      return b;
    }));

    select(d.default);
  } catch (e) {
    bubble("bot").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
})();
