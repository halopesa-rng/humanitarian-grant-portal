const form=document.querySelector("#applicationForm");
const result=document.querySelector("#result");

form.addEventListener("submit",async e=>{
 e.preventDefault();
 const data=Object.fromEntries(new FormData(form).entries());
 data.participated_before=data.participated_before==="true";
 result.classList.remove("hidden"); result.textContent="Submitting...";
 try{
  const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const j=await r.json(); if(!r.ok) throw new Error(j.error||"Unable to submit.");
  result.innerHTML=`<b>Application submitted successfully.</b><br>Reference: <strong>${j.reference}</strong><br>Status: ${j.status}<br><br>Keep this reference number.`;
  form.reset();
 }catch(err){result.textContent=err.message}
});

document.querySelector("#paymentForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const data=Object.fromEntries(new FormData(e.target).entries());
 const box=document.querySelector("#paymentResult");
 box.classList.remove("hidden"); box.textContent="Submitting...";
 try{
  const r=await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const j=await r.json(); if(!r.ok) throw new Error(j.error||"Unable to submit.");
  box.textContent=j.message; e.target.reset();
 }catch(err){box.textContent=err.message}
});

document.querySelector("#statusForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const ref=new FormData(e.target).get("reference").trim();
 const box=document.querySelector("#statusResult"); box.textContent="Checking...";
 try{
  const r=await fetch("/api/applications/"+encodeURIComponent(ref)); const j=await r.json();
  if(!r.ok) throw new Error(j.error||"Unable to check status.");
  let html=`<p><b>${j.reference}</b><br>Status: <strong>${j.status}</strong></p>`;
  if(j.admin_contact_number) html+=`<div class="notice"><b>Contact number from administrator:</b><br>${escapeHtml(j.admin_contact_number)}</div>`;
  if(j.admin_message) html+=`<p><b>Administrator message:</b><br>${escapeHtml(j.admin_message)}</p>`;
  box.innerHTML=html;
 }catch(err){box.textContent=err.message}
});

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
