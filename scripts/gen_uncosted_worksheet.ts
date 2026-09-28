import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("COGS/delivery/_uncosted_orders.json", "utf-8"));
const OUT = process.argv[2] ?? "COGS/delivery/uncosted_worksheet.html";
const data = JSON.stringify(rows);

const html = `<title>Classify uncosted deliveries — Good Fruit Club</title>
<style>
  :root{
    --bg:#f4f6f6; --surface:#ffffff; --surface-2:#eef2f2; --border:#d9e0e0;
    --text:#111a1b; --muted:#586a6c; --faint:#849798; --accent:#0e8f83;
    --accent-ink:#ffffff; --ok:#0f7a58;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1213; --surface:#141c1d; --surface-2:#1a2425; --border:#293535;
    --text:#e6eeee; --muted:#9db0b1; --faint:#6c8080; --accent:#2fb6a6;
    --accent-ink:#04201d; --ok:#3ecb9a;
  }}
  :root[data-theme="dark"]{
    --bg:#0d1213; --surface:#141c1d; --surface-2:#1a2425; --border:#293535;
    --text:#e6eeee; --muted:#9db0b1; --faint:#6c8080; --accent:#2fb6a6;
    --accent-ink:#04201d; --ok:#3ecb9a;
  }
  :root[data-theme="light"]{
    --bg:#f4f6f6; --surface:#ffffff; --surface-2:#eef2f2; --border:#d9e0e0;
    --text:#111a1b; --muted:#586a6c; --faint:#849798; --accent:#0e8f83; --accent-ink:#ffffff; --ok:#0f7a58;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:900px;margin:0 auto;padding:0 16px 96px}
  header.bar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);margin:0 -16px 18px;padding:14px 16px}
  .bar-in{max-width:900px;margin:0 auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  h1{font-size:16px;font-weight:700;margin:0}
  h1 span{color:var(--muted);font-weight:500}
  .prog{flex:1;min-width:150px;display:flex;align-items:center;gap:10px}
  .track{flex:1;height:7px;border-radius:99px;background:var(--surface-2);overflow:hidden}
  .fill{height:100%;width:0;background:var(--accent);transition:width .25s}
  .count{font-family:var(--mono);font-size:13px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  button{font-family:var(--sans);font-size:13px;font-weight:600;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:8px 14px;cursor:pointer}
  button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent}
  button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .intro{color:var(--muted);font-size:13.5px;margin:0 0 18px;max-width:66ch}
  section.day{margin:0 0 22px}
  .day-h{position:sticky;top:64px;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:4px;z-index:5;display:flex;gap:10px;align-items:baseline}
  .day-h h2{font-size:13px;font-weight:700;margin:0;text-transform:uppercase;letter-spacing:.02em}
  .day-h .n{font-family:var(--mono);font-size:12px;color:var(--faint)}
  .row{display:grid;grid-template-columns:1fr 168px 104px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
  .who{min-width:0;display:flex;flex-direction:column;gap:2px}
  .name{font-weight:600}
  .name .date{font-weight:600;font-size:11px;font-family:var(--mono);color:var(--accent);background:var(--surface-2);border-radius:6px;padding:1px 7px;margin-left:6px;white-space:nowrap;vertical-align:middle}
  .meta{font-size:11.5px;color:var(--faint);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .meta a{color:var(--accent);text-decoration:none}.meta a:hover{text-decoration:underline}
  select,input{width:100%;font-family:var(--sans);font-size:13px;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text)}
  input{font-family:var(--mono);text-align:right}
  .row.done select{border-color:var(--ok)}
  .row.nocost input{opacity:.4}
  footer.out{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);padding:12px 16px;z-index:20}
  .out-in{max-width:900px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .out-in .msg{font-size:12.5px;color:var(--muted);flex:1;min-width:140px}
  textarea{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
  @media (max-width:600px){.row{grid-template-columns:1fr 1fr;gap:8px}.who{grid-column:1/-1}}
</style>

<header class="bar"><div class="bar-in">
  <h1>Classify uncosted deliveries <span>· not on the Mover sheet</span></h1>
  <div class="prog"><div class="track"><div class="fill" id="fill"></div></div><div class="count" id="count">0 / 0</div></div>
  <button class="primary" id="copy">Copy result</button>
</div></header>

<div class="wrap">
  <p class="intro">These orders weren't on the Mover sheet — mostly Delhi drops or ones sent via another app (Porter etc.). For each, pick <strong>how it was delivered</strong> and enter the <strong>cost incurred</strong> (leave cost blank for internal / not-delivered / no-charge). Tap the address to see it on the map. Picks autosave; hit <strong>Copy result</strong> and paste back to me.</p>
  <div id="list"></div>
</div>

<footer class="out"><div class="out-in">
  <div class="msg" id="msg">Pick a method for each, then copy.</div>
  <button id="copy2" class="primary">Copy result</button>
  <textarea id="ta" readonly></textarea>
</div></footer>

<script>
const DATA = ${data};
const KEY = "gfc_uncosted_v1";
const METHODS = ["Porter","Delhi courier","Self / own rider","Mover (missed on sheet)","Other paid app","Internal (no cost)","Not delivered","No charge"];
const NOCOST = new Set(["Internal (no cost)","Not delivered","No charge"]);
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const byDate = {};
for (const r of DATA) (byDate[r.date] ||= []).push(r);
const list = document.getElementById("list");
for (const date of Object.keys(byDate).sort()) {
  const sec = document.createElement("section"); sec.className="day";
  const label = new Date(date+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
  sec.innerHTML = '<div class="day-h"><h2>'+label+'</h2><span class="n">'+byDate[date].length+' order(s)</span></div>';
  for (const r of byDate[date]) {
    const row = document.createElement("div"); row.className="row"; row.dataset.id=r.order_id;
    const maps = 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(r.address||r.customer);
    const bits = [r.items+' item'+(r.items>1?'s':'')];
    if (r.total!=null) bits.push('bill ₹'+r.total);
    const opts = ['<option value="">— method —</option>'].concat(METHODS.map(m=>'<option>'+esc(m)+'</option>')).join("");
    row.innerHTML =
      '<div class="who"><span class="name">'+esc(r.customer)+' <span class="date">'+label+'</span></span>'+
        '<span class="meta">'+bits.join(' · ')+(r.address?' · <a target="_blank" rel="noopener" href="'+maps+'">'+esc(r.address.slice(0,42))+(r.address.length>42?'…':'')+'</a>':'')+'</span></div>'+
      '<select>'+opts+'</select>'+
      '<input type="number" min="0" step="1" placeholder="₹ cost" />';
    const sel=row.querySelector("select"), cost=row.querySelector("input");
    const saved=store[r.order_id];
    if(saved){ sel.value=saved.method||""; cost.value=saved.cost??""; }
    const sync=()=>{ const m=sel.value; if(m){ store[r.order_id]={method:m,cost:cost.value===""?null:Number(cost.value)}; } else delete store[r.order_id];
      localStorage.setItem(KEY,JSON.stringify(store)); row.classList.toggle("done",!!m); row.classList.toggle("nocost",NOCOST.has(m)); update(); };
    sel.addEventListener("change",sync); cost.addEventListener("input",sync);
    row.classList.toggle("done",!!(saved&&saved.method)); if(saved&&NOCOST.has(saved.method))row.classList.add("nocost");
    list.appendChild(row);
  }
}
function update(){ const done=Object.keys(store).length; document.getElementById("count").textContent=done+" / "+DATA.length; document.getElementById("fill").style.width=(DATA.length?done/DATA.length*100:0)+"%"; }
function result(){ return DATA.filter(r=>store[r.order_id]).map(r=>({order_id:r.order_id,date:r.date,customer:r.customer,method:store[r.order_id].method,cost:store[r.order_id].cost})); }
function copy(){ const j=JSON.stringify(result(),null,2); const ta=document.getElementById("ta"); ta.value=j; ta.select();
  navigator.clipboard.writeText(j).then(()=>flash(result().length+" classified — paste back in chat."),()=>flash("Copied to hidden box; select-all not available — try again.")); }
function flash(m){ const e=document.getElementById("msg"); e.textContent=m; e.style.color="var(--accent)"; setTimeout(()=>e.style.color="var(--muted)",2500); }
document.getElementById("copy").addEventListener("click",copy); document.getElementById("copy2").addEventListener("click",copy);
update();
</script>`;
writeFileSync(OUT, html);
console.log("wrote " + OUT + " (" + rows.length + " orders)");
