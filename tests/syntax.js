// Syntax-checks every inline <script> in index.html
const fs=require("fs"),vm=require("vm");const html=fs.readFileSync(require("path").join(__dirname,"..","index.html"),"utf8");
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,n=0,bad=0;
while((m=re.exec(html))){n++;try{new vm.Script(m[1],{filename:"inline"+n+".js"})}catch(e){bad++;console.error("Script",n,e.message)}}
console.log(`${n} inline script(s), ${bad} with syntax errors`);process.exit(bad?1:0);
