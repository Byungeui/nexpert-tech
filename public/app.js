// 채팅 화면.
//
// 마크다운은 라이브러리를 쓰지 않고 최소한만 직접 그린다 — 표·코드·목록·강조.
// 답변에 표를 쓰라고 시스템 프롬프트에서 지시하므로 표는 반드시 필요하다.
// ⚠ 반드시 escape 를 먼저 하고 그 뒤에 마크업을 넣는다. 순서가 바뀌면 XSS 다.
//
// 대화 보관은 store.js 가 맡는다. **이 파일은 저장소가 브라우저인지 서버인지 몰라야
// 한다** — 나중에 DynamoDB 로 옮길 때 여기를 안 고치기 위해서다.

const log = document.getElementById("log");
const form = document.getElementById("form");
const q = document.getElementById("q");
const sendBtn = document.getElementById("send");
const tabs = document.getElementById("tabs");
const examples = document.getElementById("examples");

const drawer = document.getElementById("drawer");
const chatList = document.getElementById("chatlist");
const chatNote = document.getElementById("drawernote");
const chatTotal = document.getElementById("drawertotal");
const chatCount = document.getElementById("chatcount");

// 대화는 카테고리에 속한다. 보안장비 이야기를 하다 Azure 탭으로 옮겼는데 앞의 대화가
// 그대로 따라가면, 서버가 갈아 끼운 규칙과 이력이 어긋나 답이 흐려진다. 예전에는 탭을
// 바꿀 때 이력을 **버려서** 그걸 막았는데, 보관이 생긴 지금은 버릴 이유가 없다 —
// 탭 전환은 "그 카테고리에서 마지막으로 하던 대화로 이동"이다.
let chatId = null;       // 지금 보고 있는 대화. null 이면 아직 저장 안 된 새 대화
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

// ── 사용량 표시 ───────────────────────────────────────────────────
//
// 금액은 **서버가 계산해서 내려준다**(src/pricing.js). 여기서 요율을 곱하지 않는다 —
// 요율이 바뀔 때마다 화면을 배포해야 하고, 캐시된 옛 app.js 를 쥔 브라우저는 다른
// 금액을 보여주기 때문이다. 요율을 모르면 서버가 costUsd 를 null 로 준다.

const n = (x) => (x || 0).toLocaleString("ko-KR");

function tokensOf(u) {
  return (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
}

function usageText(u) {
  const t = `토큰 ${n(tokensOf(u))}`;
  return typeof u.costUsd === "number" ? `${t} · $${u.costUsd.toFixed(4)}` : t;
}

// 자세한 내역은 툴팁으로만 둔다. 답변마다 네 숫자를 늘어놓으면 대화가 안 읽힌다.
function usageDetail(u) {
  return `입력 ${n(u.input)} · 출력 ${n(u.output)} · 캐시읽기 ${n(u.cacheRead)} · 캐시쓰기 ${n(u.cacheWrite)}`;
}

function attachUsage(wrap, u) {
  if (!u) return;
  const el = document.createElement("div");
  el.className = "usage";
  el.textContent = usageText(u);
  el.title = usageDetail(u);
  wrap.appendChild(el);
}

// ── 말풍선 ────────────────────────────────────────────────────────
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

function drawMsg(m) {
  const body = bubble(m.role === "user" ? "user" : "bot");
  if (m.role === "user") {
    body.textContent = m.content;
  } else {
    body.innerHTML = render(m.content);
    attachUsage(body.parentElement, m.usage);
  }
}

async function ask(question) {
  if (busy || !question.trim()) return;
  busy = true;
  sendBtn.disabled = true;
  // 대화가 시작되면 목록을 위에서부터 채운다 (style.css 의 .started 참고)
  document.body.classList.add("started");

  // 서버에 보낼 이력은 **지금 질문을 넣기 전** 상태다. 서버가 질문을 따로 붙인다.
  const chat = chatId ? Store.get(chatId) : null;
  const history = chat ? chat.msgs.map((m) => ({ role: m.role, content: m.content })) : [];

  bubble("user").textContent = question;
  const body = bubble("bot");
  body.className = "body typing";

  let answer = "";
  let usage = null;
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
        } else if (ev === "done") {
          usage = data;
        } else if (ev === "error") {
          throw new Error(data);
        }
      }
    }

    if (!answer) throw new Error("빈 응답을 받았습니다.");

    // ⚠ **성공했을 때만 저장한다.** 실패한 질문까지 남으면 다시 열었을 때 질문만
    //   있고 답이 없는 자리가 생기고, 그 이력이 다음 요청에 그대로 실려 간다.
    if (!chatId) chatId = Store.create(current.key).id;
    Store.addMsg(chatId, "user", question);
    Store.addMsg(chatId, "assistant", answer, usage);
    attachUsage(body.parentElement, usage);
    refreshCount();
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

// 안내 카드는 대화 목록의 첫 항목이다. 말풍선이 아니라 카드로 그린다 —
// 답변이 아니라 "이 탭이 무엇을 근거로 답하는가"를 알리는 안내이기 때문이다.
function introCard(cat) {
  const badge = cat.key !== "secui" && mcpOn ? '<span class="badge">문서 조회</span>' : "";
  const card = document.createElement("div");
  card.className = "card intro";
  card.innerHTML =
    `<h2>${esc(cat.label)}<span style="color:var(--dim);font-weight:400"> · ${esc(cat.tagline)}</span>${badge}</h2>` +
    `<ul class="scope">${cat.intro.map(([t, d]) => `<li><b>${esc(t)}</b> — ${esc(d)}</li>`).join("")}</ul>` +
    `<p class="note">${esc(cat.note)}</p>`;
  return card;
}

// 탭 상태와 예시 질문만 바꾼다. 화면에 무엇을 그릴지는 openChat 이 정한다.
function setCategory(key) {
  const cat = catalog.find((c) => c.key === key);
  if (!cat) return;
  current = cat;

  for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.key === cat.key));

  examples.replaceChildren(...cat.examples.map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t;
    return b;
  }));
}

// chat 이 null 이면 '새 대화'다. 이 시점에는 저장하지 않는다 —
// 열어만 보고 안 물으면 빈 대화가 목록에 쌓인다.
function openChat(chat) {
  chatId = chat ? chat.id : null;
  log.replaceChildren(introCard(current));
  document.body.classList.toggle("started", !!(chat && chat.msgs.length));
  if (chat) for (const m of chat.msgs) drawMsg(m);
  refreshCount();
  q.focus();
}

// ── 저장된 대화 서랍 ──────────────────────────────────────────────
function refreshCount() {
  chatCount.textContent = String(Store.list().length);
}

function dateText(ms) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function catLabel(key) {
  return catalog.find((c) => c.key === key)?.label || key;
}

function chatRow(c) {
  const li = document.createElement("li");

  const open = document.createElement("button");
  open.type = "button";
  open.className = "chatopen";
  const title = document.createElement("b");
  title.textContent = c.title;
  const meta = document.createElement("small");
  meta.textContent = `${catLabel(c.cat)} · ${dateText(c.updated)} · ${usageText(Store.totals(c))}`;
  open.append(title, meta);
  open.addEventListener("click", () => {
    setCategory(c.cat);
    openChat(Store.get(c.id));
    closeDrawer();
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "chatdel";
  del.textContent = "×";
  del.setAttribute("aria-label", `${c.title} 삭제`);
  del.addEventListener("click", () => {
    Store.remove(c.id);
    if (chatId === c.id) openChat(null);   // 보고 있던 대화를 지웠으면 화면도 비운다
    fillDrawer();
    refreshCount();
  });

  li.append(open, del);
  return li;
}

function fillDrawer() {
  const chats = Store.list();
  chatList.replaceChildren(...chats.map(chatRow));

  const all = Store.allTotals();
  chatTotal.textContent = chats.length ? `${chats.length}개 대화 · ${usageText(all)}` : "";

  // 요율을 안 넣었으면 금액이 아예 안 나온다. 왜 안 나오는지 여기서 한 번 알린다 —
  // **없는 금액을 만들어 보여주는 것보다 낫다** (src/pricing.js 참고).
  if (!chats.length) chatNote.textContent = "저장된 대화가 없습니다.";
  else if (all.costUsd === null) chatNote.textContent = "Bedrock 요율이 설정되지 않아 토큰만 표시합니다.";
  else chatNote.textContent = "";
}

function openDrawer() { fillDrawer(); drawer.hidden = false; }
function closeDrawer() { drawer.hidden = true; }

document.getElementById("openchats").addEventListener("click", openDrawer);
document.getElementById("closechats").addEventListener("click", closeDrawer);
document.getElementById("newchat").addEventListener("click", () => openChat(null));

// 바깥(어두운 배경)을 누르면 닫는다. 패널 안쪽 클릭은 여기까지 안 온다.
drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });

document.getElementById("clearall").addEventListener("click", () => {
  if (!Store.list().length) return;
  if (!confirm("저장된 대화를 모두 지웁니다. 되돌릴 수 없습니다.")) return;
  Store.clear();
  openChat(null);
  fillDrawer();
});

// ── 시작 ──────────────────────────────────────────────────────────
(async function init() {
  Store.load();
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
      b.addEventListener("click", () => {
        setCategory(c.key);
        openChat(Store.latestFor(c.key));
      });
      return b;
    }));

    // 마지막으로 하던 대화를 그대로 이어 연다. 새로고침으로 대화가 사라지지 않는 것이
    // 이 저장소의 존재 이유이므로, 기본 화면이 아니라 **직전 상태**로 시작한다.
    const last = Store.list().find((c) => catalog.some((x) => x.key === c.cat));
    setCategory(last ? last.cat : d.default);
    openChat(last || null);
  } catch (e) {
    bubble("bot").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
})();
