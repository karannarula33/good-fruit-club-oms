import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("COGS/delivery/_unresolved.json", "utf-8"));
const OUT = process.argv[2] ?? "COGS/delivery/resolve_tail.html";

const data = JSON.stringify(rows);

const html = `<title>Resolve delivery tail — Good Fruit Club</title>
<style>
  :root{
    --bg:#f4f6f6; --surface:#ffffff; --surface-2:#eef2f2; --border:#d9e0e0;
    --text:#111a1b; --muted:#586a6c; --faint:#849798;
    --accent:#0e8f83; --accent-ink:#ffffff; --ok:#0f7a58; --pending:#a86400;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1213; --surface:#141c1d; --surface-2:#1a2425; --border:#293535;
    --text:#e6eeee; --muted:#9db0b1; --faint:#6c8080; --accent:#2fb6a6;
    --accent-ink:#04201d; --ok:#3ecb9a; --pending:#e0a24a;
  }}
  :root[data-theme="dark"]{
    --bg:#0d1213; --surface:#141c1d; --surface-2:#1a2425; --border:#293535;
    --text:#e6eeee; --muted:#9db0b1; --faint:#6c8080; --accent:#2fb6a6;
    --accent-ink:#04201d; --ok:#3ecb9a; --pending:#e0a24a;
  }
  :root[data-theme="light"]{
    --bg:#f4f6f6; --surface:#ffffff; --surface-2:#eef2f2; --border:#d9e0e0;
    --text:#111a1b; --muted:#586a6c; --faint:#849798; --accent:#0e8f83;
    --accent-ink:#ffffff; --ok:#0f7a58; --pending:#a86400;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5;
    -webkit-font-smoothing:antialiased;font-size:15px}
  .wrap{max-width:860px;margin:0 auto;padding:0 16px 96px}
  header.bar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--border);margin:0 -16px 20px;padding:14px 16px}
  .bar-in{max-width:860px;margin:0 auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  h1{font-size:16px;font-weight:700;margin:0;letter-spacing:-0.01em}
  h1 span{color:var(--muted);font-weight:500}
  .prog{flex:1;min-width:160px;display:flex;align-items:center;gap:10px}
  .track{flex:1;height:7px;border-radius:99px;background:var(--surface-2);overflow:hidden}
  .fill{height:100%;width:0;background:var(--accent);transition:width .25s ease}
  .count{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);white-space:nowrap}
  button{font-family:var(--sans);font-size:13px;font-weight:600;border-radius:9px;border:1px solid var(--border);
    background:var(--surface);color:var(--text);padding:8px 14px;cursor:pointer}
  button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent}
  button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .intro{color:var(--muted);font-size:13.5px;margin:0 0 20px;max-width:65ch}
  section.day{margin:0 0 26px}
  .day-h{display:flex;align-items:baseline;gap:10px;position:sticky;top:64px;background:var(--bg);
    padding:8px 0;z-index:5;border-bottom:1px solid var(--border);margin-bottom:6px}
  .day-h h2{font-size:13px;font-weight:700;margin:0;letter-spacing:.02em;text-transform:uppercase}
  .day-h .n{font-family:var(--mono);font-size:12px;color:var(--faint)}
  .row{display:grid;grid-template-columns:1fr auto minmax(200px,260px);gap:12px;align-items:center;
    padding:11px 0;border-bottom:1px solid var(--border)}
  .loc{display:flex;flex-direction:column;gap:2px;min-width:0}
  .plus{font-family:var(--mono);font-size:13.5px;font-weight:600;color:var(--accent);text-decoration:none;
    display:inline-flex;align-items:center;gap:6px;width:fit-content}
  .plus:hover{text-decoration:underline}
  .plus svg{width:13px;height:13px;flex:none;opacity:.8}
  .meta{font-size:11.5px;color:var(--faint);font-family:var(--mono)}
  .cost{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:14px;text-align:right;color:var(--text)}
  select{width:100%;font-family:var(--sans);font-size:13.5px;padding:8px 10px;border-radius:9px;
    border:1px solid var(--border);background:var(--surface);color:var(--text);appearance:none;
    background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);
    background-position:calc(100% - 16px) 55%,calc(100% - 11px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
  .row.done select{border-color:var(--ok)}
  .row.done .cost{color:var(--muted)}
  .other{width:100%;margin-top:6px;font-family:var(--sans);font-size:13px;padding:7px 10px;border-radius:8px;
    border:1px solid var(--border);background:var(--surface);color:var(--text)}
  .hidden{display:none}
  footer.out{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);
    padding:12px 16px;z-index:20}
  .out-in{max-width:860px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .out-in .msg{font-size:12.5px;color:var(--muted);flex:1;min-width:140px}
  textarea{width:100%;height:0;opacity:0;position:absolute;pointer-events:none}
  @media (max-width:560px){.row{grid-template-columns:1fr auto;}.row .sel{grid-column:1/-1}}
</style>

<header class="bar">
  <div class="bar-in">
    <h1>Resolve delivery tail <span>· Mover sheet → OMS</span></h1>
    <div class="prog"><div class="track"><div class="fill" id="fill"></div></div><div class="count" id="count">0 / 0</div></div>
    <button class="primary" id="copy">Copy result</button>
  </div>
</header>

<div class="wrap">
  <p class="intro">For each delivery I couldn't auto-match, tap the <strong>Plus Code</strong> to see the exact drop location on Google Maps, then pick the customer. Your picks autosave. When done (or partway), hit <strong>Copy result</strong> and paste it back to me. Two rows can share a location on the same day (e.g. a building with two customers) — the order # tells them apart.</p>
  <div id="list"></div>
</div>

<footer class="out">
  <div class="out-in">
    <div class="msg" id="msg">Pick customers above, then copy.</div>
    <button id="copy2" class="primary">Copy result</button>
    <textarea id="ta" readonly></textarea>
  </div>
</footer>

<script>
const DATA = ${data};
const KEY = "gfc_tail_v1";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
const rid = r => r.date + "|" + r.orderNum + "|" + r.plus;
const pin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="2.6"/></svg>';

const byDate = {};
for (const r of DATA) (byDate[r.date] ||= []).push(r);

const list = document.getElementById("list");
for (const date of Object.keys(byDate).sort()) {
  const rows = byDate[date];
  const sec = document.createElement("section");
  sec.className = "day";
  const dt = new Date(date + "T00:00:00");
  const label = dt.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
  sec.innerHTML = '<div class="day-h"><h2>'+label+'</h2><span class="n">'+rows.length+' to map</span></div>';
  for (const r of rows) {
    const id = rid(r);
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.id = id;
    const shortAddr = a => { a = (a||"").replace(/\\s+/g," ").trim(); return a.length>46 ? a.slice(0,44)+"…" : a; };
    const opts = ['<option value="">— pick customer —</option>']
      .concat(r.candidates.map(c => '<option value="'+esc(c.name)+'">'+esc(c.name)+(c.address?'  ·  '+esc(shortAddr(c.address)):'')+'</option>'))
      .concat(['<option value="__other">Other / not listed…</option>']).join("");
    const bits = ['order #'+esc(r.orderNum||"?")];
    if (r.dist) bits.push(esc(r.dist)+' km');
    if (r.weight) bits.push(esc(r.weight)+' kg');
    if (r.cod && Number(r.cod)>0) bits.push('COD ₹'+esc(r.cod));
    row.innerHTML =
      '<div class="loc"><a class="plus" target="_blank" rel="noopener" href="'+r.mapsUrl+'">'+pin+esc(r.plus)+'</a>'+
        '<span class="meta">'+label+' · '+bits.join(' · ')+'</span></div>'+
      '<div class="cost">₹'+r.cost.toFixed(2)+'</div>'+
      '<div class="sel"><select>'+opts+'</select>'+
        '<input class="other hidden" placeholder="Type customer name" /></div>';
    const sel = row.querySelector("select");
    const other = row.querySelector(".other");
    const saved = store[id];
    if (saved !== undefined) {
      if (r.candidates.some(c => c.name === saved)) sel.value = saved;
      else { sel.value = "__other"; other.value = saved; other.classList.remove("hidden"); }
    }
    sel.addEventListener("change", () => {
      if (sel.value === "__other") { other.classList.remove("hidden"); other.focus(); save(id, other.value.trim()); }
      else { other.classList.add("hidden"); save(id, sel.value); }
      paint(row, id);
    });
    other.addEventListener("input", () => { save(id, other.value.trim()); paint(row, id); });
    list.appendChild(row);
    paint(row, id);
  }
}

function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function save(id,val){ if(val) store[id]=val; else delete store[id]; localStorage.setItem(KEY,JSON.stringify(store)); update(); }
function paint(row,id){ row.classList.toggle("done", !!store[id]); }
function update(){
  const done = Object.keys(store).filter(k=>store[k]).length;
  document.getElementById("count").textContent = done + " / " + DATA.length;
  document.getElementById("fill").style.width = (DATA.length? done/DATA.length*100:0) + "%";
}
function result(){
  return DATA.filter(r=>store[rid(r)]).map(r=>({date:r.date,orderNum:r.orderNum,plus:r.plus,cost:r.cost,customer:store[rid(r)]}));
}
function copy(){
  const res = result();
  const json = JSON.stringify(res,null,2);
  const ta = document.getElementById("ta");
  ta.value = json; ta.select();
  navigator.clipboard.writeText(json).then(
    ()=>flash(res.length+" resolved rows copied — paste them back in chat."),
    ()=>flash("Copied to the box below — select all & copy manually.")
  );
}
function flash(m){ const el=document.getElementById("msg"); el.textContent=m; el.style.color="var(--accent)"; setTimeout(()=>el.style.color="var(--muted)",2500); }
document.getElementById("copy").addEventListener("click",copy);
document.getElementById("copy2").addEventListener("click",copy);
update();
</script>`;

writeFileSync(OUT, html);
console.log("wrote " + OUT + " (" + rows.length + " rows)");
