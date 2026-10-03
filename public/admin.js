let key="";
const msg=document.querySelector("#adminMsg");
document.querySelector("#load").addEventListener("click",load);

async function api(url,options={}){
 options.headers={...(options.headers||{}),"x-admin-key":key,"Content-Type":"application/json"};
 const r=await fetch(url,options),j=await r.json();
 if(!r.ok)throw new Error(j.error||"Request failed");
 return j;
}
async function load(){
 key=document.querySelector("#adminKey").value.trim();
 if(!key){msg.classList.remove("hidden");msg.textContent="Enter your admin key.";return}
 msg.classList.remove("hidden");msg.textContent="Loading...";
 try{
  const [apps,payments]=await Promise.all([api("/api/admin/applications"),api("/api/admin/payments")]);
  renderApps(apps); renderPayments(payments); msg.textContent="Dashboard loaded.";
 }catch(e){msg.textContent=e.message}
}
function renderApps(rows){
 if(!rows.length){document.querySelector("#applications").textContent="No applications.";return}
 document.querySelector("#applications").innerHTML=`<table><tr><th>Reference</th><th>Applicant</th><th>Contact</th><th>Status</th><th>Admin contact/message</th><th>Action</th></tr>`+
 rows.map(a=>`<tr><td>${h(a.reference)}</td><td>${h(a.full_name)}<br>${h(a.country)} / ${h(a.location)}</td><td>${h(a.phone)}</td><td>${h(a.status)}</td><td><input id="cn-${a.id}" value="${h(a.admin_contact_number||"")}" placeholder="Number customer should contact"><textarea id="cm-${a.id}" placeholder="Message to customer">${h(a.admin_message||"")}</textarea></td><td><button class="smallbtn green" onclick="updateApp(${a.id},'APPROVED')">Approve</button><button class="smallbtn red" onclick="updateApp(${a.id},'REJECTED')">Reject</button><button class="smallbtn gray" onclick="updateApp(${a.id},'NEEDS_REVIEW')">Needs review</button></td></tr>`).join("")+"</table>";
}
async function updateApp(id,status){
 try{
  await api("/api/admin/applications/"+id+"/update",{method:"POST",body:JSON.stringify({status,contact_number:document.querySelector("#cn-"+id).value,message:document.querySelector("#cm-"+id).value})});
  await load();
 }catch(e){alert(e.message)}
}
function renderPayments(rows){
 if(!rows.length){document.querySelector("#payments").textContent="No payment statements submitted.";return}
 document.querySelector("#payments").innerHTML=`<table><tr><th>Reference</th><th>Applicant</th><th>Method</th><th>Transaction</th><th>Statement</th><th>Amount</th><th>Status</th><th>Action</th></tr>`+
 rows.map(p=>`<tr><td>${h(p.reference)}</td><td>${h(p.full_name)}<br>${h(p.phone)}</td><td>${h(p.method)}</td><td>${h(p.transaction_reference||"")}</td><td style="white-space:normal;min-width:250px">${h(p.payment_statement||"")}</td><td>${h(p.amount||"")}</td><td>${h(p.status)}</td><td><button class="smallbtn green" onclick="paymentStatus(${p.id},'VERIFIED')">Verify</button><button class="smallbtn red" onclick="paymentStatus(${p.id},'REJECTED')">Reject</button></td></tr>`).join("")+"</table>";
}
async function paymentStatus(id,status){try{await api("/api/admin/payments/"+id+"/status",{method:"POST",body:JSON.stringify({status})});await load()}catch(e){alert(e.message)}}
function h(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
