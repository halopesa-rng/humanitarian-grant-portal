let step=1,reference="",selectedFund="",selectedMethod="";
const show=n=>{step=n;document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",Number(x.dataset.step)===n));document.querySelector("#stepLabel").textContent=`${n} / 5`;document.querySelector("#progressBar").style.width=(n/5*100)+"%";window.scrollTo({top:0,behavior:"smooth"})};
document.querySelector("#applicationForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target)),err=document.querySelector("#appError");err.classList.add("hidden");
 try{const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);reference=j.reference;document.querySelector("#refSummary").textContent=reference;show(2)}
 catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelectorAll('input[name="fund"]').forEach(x=>x.onchange=()=>selectedFund=x.value);
document.querySelector("#fundNext").onclick=()=>{if(!selectedFund)return alert("Select a funding option.");show(3)};
document.querySelectorAll(".method").forEach(x=>x.onclick=()=>{document.querySelectorAll(".method").forEach(b=>b.classList.remove("selected"));x.classList.add("selected");selectedMethod=x.dataset.method;document.querySelector("#methodNext").disabled=false});
document.querySelector("#methodNext").onclick=()=>{document.querySelector("#fundSummary").textContent=selectedFund;document.querySelector("#methodSummary").textContent=selectedMethod;show(4)};
document.querySelectorAll("[data-back]").forEach(x=>x.onclick=()=>show(Number(x.dataset.back)));
document.querySelector("#paymentForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.reference=reference;d.method=selectedMethod;
 const err=document.querySelector("#paymentError");err.classList.add("hidden");
 try{const r=await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);document.querySelector("#finalReference").textContent=reference;show(5)}
 catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelector("#checkStatus").onclick=()=>document.querySelector("#statusPanel").classList.toggle("hidden");
document.querySelector("#statusForm").onsubmit=async e=>{
 e.preventDefault();const r=String(new FormData(e.target).get("reference")).trim(),box=document.querySelector("#statusResult");box.textContent="Checking...";
 try{const x=await fetch("/api/applications/"+encodeURIComponent(r)),j=await x.json();if(!x.ok)throw Error(j.error);box.innerHTML=`<p>Reference: <b>${j.reference}</b><br>Funding: <b>${j.requested_fund||"—"}</b><br>Payment method: <b>${j.payment_method||"—"}</b><br>Status: <b>${j.status}</b>${j.customer_contact_number?`<br>Contact: <b>${j.customer_contact_number}</b>`:""}</p>`}
 catch(x){box.textContent=x.message}
};