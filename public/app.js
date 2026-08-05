// 채팅 화면.
//
// 마크다운은 라이브러리를 쓰지 않고 최소한만 직접 그린다 — 표·코드·목록·강조.
// 답변에 표를 쓰라고 시스템 프롬프트에서 지시하므로 표는 반드시 필요하다.
// ⚠ 반드시 escape 를 먼저 하고 그 뒤에 마크업을 넣는다. 순서가 바뀌면 XSS 다.

const log = document.getElementById("log");
const form = document.getElementById("form");
const q = document.getElementById("q");
const sendBtn = document.getElementById("send");

const history = [];
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

  bubble("user").textContent = question;
  const body = bubble("bot");
  body.className = "body typing";

  let answer = "";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
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
          body.innerHTML = render(answer);
          log.lastElementChild.scrollIntoView({ block: "end" });
        } else if (ev === "error") {
          throw new Error(data);
        }
      }
    }

    if (!answer) throw new Error("빈 응답을 받았습니다.");
    history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (e) {
    body.innerHTML = `<p style="color:#f85149">${esc(e.message)}</p>`;
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

document.getElementById("examples").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") ask(e.target.textContent);
});
