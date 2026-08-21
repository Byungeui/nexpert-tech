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
let chat = null;         // 지금 보고 있는 대화 객체. null 이면 아직 저장 안 된 새 대화
let current = null;      // 지금 선택된 카테고리 객체
let catalog = [];        // 서버가 준 카테고리 목록
let rates = null;        // 서버가 준 100만 토큰당 요율. 없으면 금액을 표시하지 않는다
let mcpOn = false;
let busy = false;

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// 블록의 시작을 알아보는 식들.
//
// ⚠ **BLOCK 은 아래 render 의 분기 집합과 반드시 일치해야 한다.** 하나라도 빠지면
//   그 줄에서 문단 분기가 먹어 치우고(예: `---` 이 글자로 보인다), 반대로 BLOCK 에만
//   있고 분기가 없으면 **아무도 그 줄을 소비하지 않아 무한 루프가 된다.**
//   그래서 따로 적지 않고 여기서 조립한다 — 베껴 적는 순간 언젠가 어긋난다.
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^\s*[-*]\s+/;
// ⚠ **자릿수를 두 자리로 묶는다.** 풀어 두면 `2026. 08. 21.` 같은 한국식 날짜가
//   번호 목록으로 둔갑한다 — 세무·견적 이야기를 하는 이 사이트에서 실제로 나오는 형태다.
const OL = /^\s*(\d{1,2})[.)]\s+/;
const TABLE = /^\s*\|/;
const FENCE = /^```/;
const HEAD = /^(#{1,4})\s+(.*)$/;
const BLOCK = new RegExp(
  [HR, UL, OL, TABLE, FENCE, /^#{1,4}\s/].map((r) => r.source).join("|")
);

function render(md) {
  const lines = esc(md).split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록
    if (FENCE.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // 표 — | 로 시작하고 다음 줄이 구분선일 때만
    if (TABLE.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && TABLE.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        "<table><thead><tr>" + head.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>"
      );
      continue;
    }

    // 가로줄. ⚠ **표 구분선(`|---|`)보다 뒤에서 본다** — 표 분기가 먼저 가져가야 한다.
    // 문단으로 흘려보내면 `---` 이 글자 그대로 보인다.
    if (HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // 목록
    if (UL.test(line)) {
      const items = [];
      while (i < lines.length && UL.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(UL, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 번호 목록. 1 로 시작하지 않으면 start 를 붙인다 — 답변이 "3. 부터"로 이어질 때
    // 번호가 1 로 되돌아가면 앞 문단과 말이 어긋난다.
    if (OL.test(line)) {
      const start = Number(line.match(OL)[1]);
      const items = [];
      while (i < lines.length && OL.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(OL, ""))}</li>`);
        i++;
      }
      out.push(`<ol${start === 1 ? "" : ` start="${start}"`}>${items.join("")}</ol>`);
      continue;
    }

    // 제목
    const h = line.match(HEAD);
    if (h) {
      const lv = Math.min(h[1].length + 2, 6);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // 문단 — 빈 줄까지 모은다
    const buf = [];
    while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i])) {
      buf.push(lines[i++]);
    }
    // ⚠ **여기서 한 줄도 못 먹으면 i 가 안 늘어 바깥 while 이 영원히 돈다.**
    // BLOCK 은 `|` 로 시작하는 줄을 제외하는데, 표 분기는 "다음 줄이 구분선일 때만"
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
// **요율표는 서버에만 있다**(src/pricing.js). 화면은 접속할 때 받아 두고 계산만 한다.
// 여기에 숫자를 적어 두면 요율을 고칠 때 두 곳을 고쳐야 하고, 캐시된 옛 app.js 를 쥔
// 브라우저가 다른 금액을 보여준다.

const n = (x) => (x || 0).toLocaleString("ko-KR");

function tokensOf(u) {
  return (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
}

// ⚠ **금액은 저장하지 않고 볼 때마다 계산한다.** 답변마다 금액을 굳혀 두면 요율을
// 고쳐도 지난 대화는 옛 금액을 들고 있어 한 화면에 두 기준이 섞인다. 토큰은 사실이라
// 변하지 않지만 요율은 바뀐다 — 변하는 쪽을 저장하지 않는 게 맞다.
// (회계 기록으로 굳혀야 하는 금액은 서버가 그때의 요율로 CloudWatch 에 남긴다.)
function costOf(u) {
  if (!rates || !u) return null;
  let sum = 0;
  for (const k of ["input", "output", "cacheWrite", "cacheRead"]) {
    const tok = u[k] || 0;
    if (!tok) continue;
    if (typeof rates[k] !== "number") return null;   // 쓴 항목의 요율을 모르면 표시하지 않는다
    sum += (tok * rates[k]) / 1e6;
  }
  return sum;
}

// 답변 하나는 몇 센트, 합계는 몇 달러다. 한 자릿수로 고정하면 한쪽이 늘 못 읽힌다 —
// 답변마다 `$0.03` 이면 차이가 안 보이고, 합계가 `$1.2400` 이면 지저분하다.
function money(v) {
  if (typeof v !== "number") return null;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

function usageText(u) {
  const t = `토큰 ${n(tokensOf(u))}`;
  const m = money(costOf(u));
  return m ? `${t} · ${m}` : t;
}

// 자세한 내역은 툴팁으로만 둔다. 답변마다 네 숫자를 늘어놓으면 대화가 안 읽힌다.
// 캐시 쓰기가 입력보다 비싸므로 **첫 질문이 이어지는 질문보다 비싸다** — 금액이
// 들쭉날쭉해 보이는 이유가 이것이고, 그건 여기 내역을 봐야 납득이 된다.
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
  const history = chat ? (chat.msgs || []).map((m) => ({ role: m.role, content: m.content })) : [];

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
    if (!chat) chat = Store.create(current.key);
    await Store.addMsg(chat, "user", question);
    const saved = await Store.addMsg(chat, "assistant", answer, usage);
    attachUsage(body.parentElement, usage);
    // 서버에 못 올렸으면 알린다. 화면에는 남아 있지만 **다른 기기에서는 안 보인다** —
    // 조용히 두면 폰에서 없는 걸 보고서야 알게 된다. 다음 접속 때 자동으로 다시 올린다.
    if (!saved) {
      const warn = document.createElement("div");
      warn.className = "usage warn";
      warn.textContent = "이 기기에만 저장됐습니다. 다시 접속하면 서버로 올립니다.";
      body.parentElement.appendChild(warn);
    }
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

// id 가 null 이면 '새 대화'다. 이 시점에는 저장하지 않는다 —
// 열어만 보고 안 물으면 빈 대화가 목록에 쌓인다.
//
// 목록에는 본문이 없으므로 **열 때 받아온다**(Store.get). 그래서 비동기다.
async function openChat(id) {
  chat = id ? await Store.get(id) : null;
  log.replaceChildren(introCard(current));
  const msgs = (chat && chat.msgs) || [];
  document.body.classList.toggle("started", msgs.length > 0);
  for (const m of msgs) drawMsg(m);
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
  open.addEventListener("click", async () => {
    setCategory(c.cat);
    closeDrawer();
    await openChat(c.id);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "chatdel";
  del.textContent = "×";
  del.setAttribute("aria-label", `${c.title} 삭제`);
  del.addEventListener("click", async () => {
    const wasOpen = chat && chat.id === c.id;
    await Store.remove(c.id);
    if (wasOpen) await openChat(null);   // 보고 있던 대화를 지웠으면 화면도 비운다
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

  // 어디에 저장되고 있는지 여기서 한 번 알린다. **기기 간에 이어지는지 아닌지는
  // 눈으로 구분할 수 없어서**, 안 알리면 폰에서 없는 걸 보고서야 알게 된다.
  if (Store.degraded) {
    chatNote.textContent = "서버 저장에 실패해 이 기기에만 있습니다. 다시 접속하면 올립니다.";
  } else if (!Store.online) {
    chatNote.textContent = "이 브라우저에만 저장됩니다 — 다른 기기에서는 보이지 않습니다.";
  } else if (!chats.length) {
    chatNote.textContent = "저장된 대화가 없습니다.";
  } else if (costOf(all) === null) {
    chatNote.textContent = "이 모델의 요율이 없어 토큰만 표시합니다.";
  } else {
    chatNote.textContent = "모든 기기에서 이어집니다 · 금액은 Bedrock 요율 기준 추정입니다.";
  }
}

function openDrawer() { fillDrawer(); drawer.hidden = false; }
function closeDrawer() { drawer.hidden = true; }

document.getElementById("openchats").addEventListener("click", openDrawer);
document.getElementById("closechats").addEventListener("click", closeDrawer);
document.getElementById("newchat").addEventListener("click", () => { openChat(null); });

// 바깥(어두운 배경)을 누르면 닫는다. 패널 안쪽 클릭은 여기까지 안 온다.
drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });

document.getElementById("clearall").addEventListener("click", async () => {
  if (!Store.list().length) return;
  const where = Store.online ? "모든 기기에서" : "이 브라우저에서";
  if (!confirm(`저장된 대화를 ${where} 모두 지웁니다. 되돌릴 수 없습니다.`)) return;
  await Store.clear();
  await openChat(null);
  fillDrawer();
});

// ── 시작 ──────────────────────────────────────────────────────────
(async function init() {
  try {
    const r = await fetch("/api/categories");
    if (!r.ok) throw new Error(`카테고리를 불러오지 못했습니다 (${r.status})`);
    const d = await r.json();
    catalog = d.categories;
    mcpOn = !!d.mcp;
    rates = d.rates || null;

    // 서버 저장이 켜져 있는지는 **서버가 알려준다.** 화면이 짐작하지 않는다.
    // 여기서 지난 대화 목록을 받아오고, 못 올린 게 있으면 이때 올라간다.
    await Store.init(d.chats);

    tabs.replaceChildren(...catalog.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.key = c.key;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", "false");
      b.innerHTML = `${esc(c.label)}<small>${esc(c.tagline)}</small>`;
      b.addEventListener("click", async () => {
        setCategory(c.key);
        const latest = Store.latestFor(c.key);
        await openChat(latest ? latest.id : null);
      });
      return b;
    }));

    // 마지막으로 하던 대화를 그대로 이어 연다. 새로고침해도, 다른 기기에서 열어도
    // **직전 상태**로 시작하는 것이 이 저장소의 존재 이유다.
    const last = Store.list().find((c) => catalog.some((x) => x.key === c.cat));
    setCategory(last ? last.cat : d.default);
    await openChat(last ? last.id : null);
  } catch (e) {
    bubble("bot").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
})();
