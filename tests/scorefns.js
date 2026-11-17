// Extracts the scoring functions' source so tests can prove they are unchanged.
const fs=require("fs");
function grab(src,name){const i=src.indexOf("function "+name+"(");if(i<0)return null;let j=src.indexOf("{",i),d=0;for(let k=j;k<src.length;k++){const c=src[k];if(c==="{")d++;else if(c==="}"){d--;if(!d)return src.slice(i,k+1)}}return null}
const NAMES=["scoreMarket","passesPreset","scoreSymbol"];
function hashes(file){const s=fs.readFileSync(file,"utf8"),h=require("crypto");return Object.fromEntries(NAMES.map(n=>{const g=grab(s,n);return[n,g&&h.createHash("sha256").update(g).digest("hex").slice(0,16)]}))}
// sha256 (first 16 hex) of each function in the original baseline index.html (commit 1c48048)
const BASE={"scoreMarket":"43a7840737360878","passesPreset":"74ec0d66dde83a4a","scoreSymbol":"a760b7a414bbdcdc"};
module.exports={hashes,NAMES,BASE};
if(require.main===module)console.log(JSON.stringify(hashes(process.argv[2])));
