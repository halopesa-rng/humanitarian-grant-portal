let step=1,reference="",selectedFund="",selectedMethod="";
const show=n=>{step=n;document.querySelectorAll(".step").forEach(s=>s.classList.toggle("active",Number(s.dataset.step)===n));document.querySelectorAll(".progress span").forEach((s,i)=>s.classList.toggle("active",i+1===n));window.scrollTo({top:0,behavior:"smooth"})};
const form=document.querySelector("#applicationForm");
form.onsubmit=async e=>{
 e.preventDefault();
 const d=Object.fromEntries(new FormData(form));
 const box=document.querySelector("#appResult");box.classList.remove("hidden");box.textContent="Submitting application...";
 try{
  const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});
  const j=await r.json();if(!r.ok)throw Error(j.error);
  reference=j.reference;document.querySelector("#referenceBox").textContent=reference;show(2);
 }catch(x){box.textContent=x.message}
};
document.querySelectorAll('input[name="fund"]').forEach(x=>x.onchange=()=>{selectedFund=x.value});
document.querySelector("#fundNext").onclick=()=>{
 if(!selectedFund)return alert("Please select the funding amount.");
 show(3);
};
document.querySelectorAll(".method").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".method").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");
 selectedMethod=b.dataset.method;document.querySelector("#selectedMethod").textContent="Selected: "+selectedMethod;
 document.querySelector("#methodNext").disabled=false;
});
document.querySelector("#methodNext").onclick=async()=>{
 try{
  const r=await fetch(`/api/applications/${encodeURIComponent(reference)}/funding`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requested_fund:selectedFund,payment_method:selectedMethod})});
  const j=await r.json();if(!r.ok)throw Error(j.error);show(4);
 }catch(x){alert(x.message)}
};
document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>show(Number(b.dataset.back)));
document.querySelector("#checkStatus").onclick=()=>document.querySelector("#statusPanel").classList.toggle("hidden");
document.querySelector("#statusForm").onsubmit=async e=>{
 e.preventDefault();const ref=new FormData(e.target).get("reference"),box=document.querySelector("#statusResult");box.textContent="Checking...";
 try{const r=await fetch("/api/applications/"+encodeURIComponent(ref)),j=await r.json();if(!r.ok)throw Error(j.error);
 box.innerHTML=`<p>Reference: <b>${j.reference}</b><br>Requested funding: <b>${j.requested_fund||"Not selected"}</b><br>Payment method: <b>${j.payment_method||"Not selected"}</b><br>Status: <b>${j.status}</b>${j.customer_contact_number?`<br><br>Administrator contact: <b>${j.customer_contact_number}</b>`:""}</p>`;
 }catch(x){box.textContent=x.message}
};