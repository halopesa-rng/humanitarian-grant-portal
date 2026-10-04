let step=1,reference="",selectedFund="",selectedMethod="",statusTimer=null;
const params=new URLSearchParams(location.search);
const customerToken=params.get("agent")||sessionStorage.getItem("whf_customer_token")||"";
reference=sessionStorage.getItem("whf_application_reference")||"";
if(params.get("agent"))sessionStorage.setItem("whf_customer_token",params.get("agent"));
const show=n=>{step=n;document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",Number(x.dataset.step)===n));document.querySelector("#stepLabel").textContent=`${n} / 5`;document.querySelector("#progressBar").style.width=(n/5*100)+"%";window.scrollTo({top:0,behavior:"smooth"})};
const fundAmount=f=>String(f||"").match(/ZMW\s*[\d,]+/i)?.[0]||String(f||"");
function showOutcome(j){
 const pending=document.querySelector("#pendingCard"),approved=document.querySelector("#approvedCard"),rejected=document.querySelector("#rejectedCard");
 pending.classList.add("hidden");approved.classList.add("hidden");rejected.classList.add("hidden");
 if(j.status==="APPROVED"){
  document.querySelector("#approvedAmount").textContent=fundAmount(j.requested_fund);
  document.querySelector("#approvedMethod").textContent=j.payment_method||"selected wallet";
  document.querySelector("#approvedReference").textContent=j.reference;
  approved.classList.remove("hidden");
 }else if(j.status==="REJECTED"){
  document.querySelector("#rejectedReference").textContent=j.reference;
  rejected.classList.remove("hidden");
 }else{
  pending.classList.remove("hidden");
 }
}
async function getStatus(ref,auto=false){
 try{
  const r=await fetch("/api/applications/"+encodeURIComponent(ref)),j=await r.json();
  if(!r.ok)throw Error(j.error||"Unable to check status.");
  if(!auto){document.querySelector("#statusResult").innerHTML=`<p>Reference: <b>${j.reference}</b><br>Funding: <b>${j.requested_fund||"—"}</b><br>Payment method: <b>${j.payment_method||"—"}</b><br>Status: <b>${j.status}</b></p>`}
  if(step===5)showOutcome(j);
  if(j.status!=="PENDING"&&statusTimer){clearInterval(statusTimer);statusTimer=null;}
  return j;
 }catch(x){if(!auto)document.querySelector("#statusResult").textContent=x.message;return null}
}
function startStatusPolling(){if(statusTimer)clearInterval(statusTimer);getStatus(reference,true);statusTimer=setInterval(()=>getStatus(reference,true),5000)}
document.querySelector("#applicationForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target)),err=document.querySelector("#appError");err.classList.add("hidden");d.customer_token=customerToken;
 try{const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);reference=j.reference;sessionStorage.setItem("whf_application_reference",reference);document.querySelector("#refSummary").textContent=reference;show(2)}catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelectorAll('input[name="fund"]').forEach(x=>x.onchange=()=>selectedFund=x.value);
document.querySelector("#fundNext").onclick=()=>{if(!selectedFund)return alert("Select a funding option.");show(3)};
document.querySelectorAll(".method").forEach(x=>x.onclick=()=>{document.querySelectorAll(".method").forEach(b=>b.classList.remove("selected"));x.classList.add("selected");selectedMethod=x.dataset.method;document.querySelector("#methodNext").disabled=false});
document.querySelector("#methodNext").onclick=async()=>{
 if(!selectedMethod)return alert("Select a payment method.");
 try{const r=await fetch(`/api/applications/${encodeURIComponent(reference)}/funding`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requested_fund:selectedFund,payment_method:selectedMethod,customer_token:customerToken})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Unable to save funding selection.");document.querySelector("#fundSummary").textContent=selectedFund;document.querySelector("#methodSummary").textContent=selectedMethod;show(4)}catch(x){alert(x.message)}
};
document.querySelectorAll("[data-back]").forEach(x=>x.onclick=()=>show(Number(x.dataset.back)));
document.querySelector("#paymentForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.reference=reference;d.method=selectedMethod;d.customer_token=customerToken;
 const err=document.querySelector("#paymentError");err.classList.add("hidden");
 try{const r=await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);document.querySelector("#finalReference").textContent=reference;show(5);startStatusPolling()}catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelector("#checkStatus").onclick=()=>{document.querySelector("#statusPanel").classList.toggle("hidden");if(reference){document.querySelector('#statusForm input[name="reference"]').value=reference;getStatus(reference,false)}};
document.querySelector("#statusForm").onsubmit=async e=>{e.preventDefault();const r=String(new FormData(e.target).get("reference")).trim();await getStatus(r,false)};
