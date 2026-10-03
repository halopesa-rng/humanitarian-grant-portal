const form=document.querySelector("#applicationForm"), result=document.querySelector("#result");
form.addEventListener("submit",async e=>{
 e.preventDefault(); const data=Object.fromEntries(new FormData(form).entries());
 data.participated_before=data.participated_before==="true";
 const r=await fetch("/api/applications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 const j=await r.json();
 result.classList.remove("hidden");
 result.innerHTML=r.ok?`<b>Application submitted successfully.</b><br>Reference: <strong>${j.reference}</strong><br>Status: ${j.status}. Keep this reference number to check your application.`:`<b>Error:</b> ${j.error||"Unable to submit."}`;
 if(r.ok) form.reset();
});
document.querySelector("#statusForm").addEventListener("submit",async e=>{
 e.preventDefault();const ref=new FormData(e.target).get("reference").trim();
 const r=await fetch("/api/applications/"+encodeURIComponent(ref));const j=await r.json();
 document.querySelector("#statusResult").innerHTML=r.ok?`<p><b>${j.reference}</b><br>Status: <strong>${j.status}</strong></p>`:`<p>${j.error}</p>`;
});
