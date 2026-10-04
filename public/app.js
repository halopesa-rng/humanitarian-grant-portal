let step=1,reference="",selectedFund="",selectedMethod="",paymentNumbers={MTN:"",AIRTEL:""};
async function loadPaymentConfig(){try{const r=await fetch("/api/config?agent="+encodeURIComponent(agentToken));const j=await r.json();if(r.ok){paymentNumbers={MTN:j.mtnNumber||"",AIRTEL:j.airtelNumber||""};}}catch(e){console.error(e)}}
const params=new URLSearchParams(location.search),agentToken=params.get("agent")||"";
const show=n=>{step=n;document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",Number(x.dataset.step)===n));document.querySelector("#stepLabel").textContent=`${n} / 5`;document.querySelector("#progressBar").style.width=(n/5*100)+"%";window.scrollTo({top:0,behavior:"smooth"})};
document.querySelector("#applicationForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(agentToken)d.agent_token=agentToken;
 const err=document.querySelector("#appError");err.classList.add("hidden");
 try{const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);reference=j.reference;document.querySelector("#refSummary").textContent=reference;show(2)}
 catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelectorAll('input[name="fund"]').forEach(x=>x.onchange=()=>selectedFund=x.value);
document.querySelector("#fundNext").onclick=()=>{if(!selectedFund)return alert("Select a funding option.");show(3)};
document.querySelectorAll(".method").forEach(x=>x.onclick=async()=>{document.querySelectorAll(".method").forEach(b=>b.classList.remove("selected"));x.classList.add("selected");selectedMethod=x.dataset.method;await loadPaymentConfig();const n=paymentNumbers[selectedMethod]||"Payment number not yet provided by your administrator.";document.querySelector("#activePaymentNumber").textContent=n;document.querySelector("#activePaymentMethod").textContent=selectedMethod;document.querySelector("#methodNext").disabled=false});
document.querySelector("#methodNext").onclick=async()=>{
 document.querySelector("#fundSummary").textContent=selectedFund;document.querySelector("#methodSummary").textContent=selectedMethod;
 try{const r=await fetch("/api/applications/"+encodeURIComponent(reference)+"/funding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requested_fund:selectedFund,payment_method:selectedMethod})});const j=await r.json();if(!r.ok)throw Error(j.error);show(4)}
 catch(x){alert(x.message)}
};
document.querySelectorAll("[data-back]").forEach(x=>x.onclick=()=>show(Number(x.dataset.back)));
document.querySelector("#paymentForm").onsubmit=async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.reference=reference;d.method=selectedMethod;
 const err=document.querySelector("#paymentError");err.classList.add("hidden");
 try{const r=await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json();if(!r.ok)throw Error(j.error);document.querySelector("#finalReference").textContent=reference;show(5)}
 catch(x){err.textContent=x.message;err.classList.remove("hidden")}
};
document.querySelector("#checkStatus").onclick=async()=>{
 document.querySelector("#statusPanel").classList.remove("hidden");await checkStatus(reference);
};
document.querySelector("#statusForm").onsubmit=async e=>{e.preventDefault();const r=String(new FormData(e.target).get("reference")).trim();await checkStatus(r)};
async function checkStatus(r){
 const box=document.querySelector("#statusResult");box.textContent="Checking...";
 try{
  const x=await fetch("/api/applications/"+encodeURIComponent(r)),j=await x.json();if(!x.ok)throw Error(j.error);
  if(j.status==="APPROVED"){document.querySelector("#statusPanel").innerHTML=`<div class="status-approved"><img src="/celebration.png" alt="Congratulations"><h2>🎉 Congratulations!</h2><p>Your application has been <b>APPROVED</b>.</p><p>You have been awarded <b>${j.requested_fund||"the amount you applied for"}</b> and it is in process of being sent to your selected wallet.</p><p><b>Reference:</b> ${j.reference}</p></div>`;return}
  if(j.status==="REJECTED"){document.querySelector("#statusPanel").innerHTML=`<div class="status-rejected"><h2>Application Unsuccessful</h2><p>Your application is unsuccessful because the required processing fee was not received/verified.</p><p>Please make the required payment and try again.</p><p><b>Reference:</b> ${j.reference}</p></div>`;return}
  box.innerHTML=`<p>Reference: <b>${j.reference}</b><br>Funding: <b>${j.requested_fund||"—"}</b><br>Payment method: <b>${j.payment_method||"—"}</b><br>Application status: <b>${j.status}</b><br>Payment status: <b>${j.payment_status||"PENDING"}</b>${j.customer_contact_number?`<br>Contact: <b>${j.customer_contact_number}</b>`:""}</p>`;
 }catch(x){box.textContent=x.message}
}

loadPaymentConfig();
