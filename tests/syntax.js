// Syntax-checks every inline JavaScript <script> in index.html
// (skips src= scripts and non-JS types such as application/ld+json).
const fs=require("fs"),vm=require("vm");const html=fs.readFileSync(require("path").join(__dirname,"..","index.html"),"utf8");
const re=/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;let m,n=0,bad=0;
while((m=re.exec(html))){
  const attrs=m[1]||"";
  if(/\bsrc\s*=/i.test(attrs))continue;
  if(/\btype\s*=\s*["']?(application\/ld\+json|application\/json|importmap)/i.test(attrs))continue;
  n++;
  try{new vm.Script(m[2],{filename:"inline"+n+".js"})}catch(e){bad++;console.error("Script",n,e.message)}
}
console.log(`${n} inline script(s), ${bad} with syntax errors`);process.exit(bad?1:0);
