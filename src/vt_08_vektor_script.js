// ---------- Vektor Script: a small, safe indicator language ----------
// Own tokenizer, parser and evaluator. Source text is never passed to eval/Function; there is no member access, no loops,
// no strings beyond literal titles/colours, and names resolve only from the fixed tables below (a null-prototype map), so a
// script can't reach the page, the network or storage. Work is bounded: series are arrays the length of the chart's bars,
// lengths are capped and the number of evaluated nodes is limited.
const VS_LIM={src:20000,stmts:300,depth:40,len:1000,plots:12,hlines:8,nodes:2e6};
class VSError extends Error{constructor(msg,line,col,hint){super(msg);this.line=line||0;this.col=col||0;this.hint=hint||""}}
const VS_SERIES=["open","high","low","close","volume","hl2","hlc3","ohlc4","bar_index","time"];
const VS_COLORS=Object.assign(Object.create(null),{blue:"#2962ff",red:"#f23645",green:"#089981",orange:"#fb923c",yellow:"#f5c518",purple:"#9c27b0",teal:"#00897b",gray:"#787b86",grey:"#787b86",white:"#ffffff",black:"#131722",aqua:"#00bcd4",lime:"#76ff03",fuchsia:"#e040fb",navy:"#1a237e",maroon:"#880e4f",olive:"#827717",silver:"#b2b5be"});
const vsOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
// ---- tokenizer
function vsLex(src){const T=[];let i=0,line=1,col=1;const n=src.length;
  const push=(t,v,l,c)=>T.push({t,v,line:l,col:c});
  while(i<n){const ch=src[i],l=line,c=col;
    if(ch==="\n"){push("nl","\n",l,c);i++;line++;col=1;continue}
    if(ch===" "||ch==="\t"||ch==="\r"){i++;col++;continue}
    if(ch==="/"&&src[i+1]==="/"){while(i<n&&src[i]!=="\n"){i++;col++}continue}
    if(/[0-9.]/.test(ch)&&/[0-9]/.test(ch==="."?src[i+1]||"":ch)){let j=i;while(j<n&&/[0-9.]/.test(src[j]))j++;if(src[j]==="e"||src[j]==="E"){j++;if(src[j]==="+"||src[j]==="-")j++;while(j<n&&/[0-9]/.test(src[j]))j++}
      const s=src.slice(i,j),v=Number(s);if(!isFinite(v))throw new VSError("\u201c"+s+"\u201d isn\u2019t a valid number",l,c);push("num",v,l,c);col+=j-i;i=j;continue}
    if(/[A-Za-z_]/.test(ch)){let j=i;while(j<n&&/[A-Za-z0-9_]/.test(src[j]))j++;const w=src.slice(i,j);push(["and","or","not","true","false","na"].includes(w)?"kw":"id",w,l,c);col+=j-i;i=j;continue}
    if(ch==="\""||ch==="'"){let j=i+1,s="";while(j<n&&src[j]!==ch){if(src[j]==="\n")throw new VSError("Text in quotes must end on the same line",l,c,"Add the closing "+ch+".");s+=src[j];j++}
      if(j>=n)throw new VSError("Text in quotes isn\u2019t closed",l,c,"Add the closing "+ch+".");if(s.length>80)throw new VSError("Text is too long (80 characters max)",l,c);push("str",s,l,c);col+=j-i+1;i=j+1;continue}
    if(ch==="#"){const m=/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(src.slice(i,i+8));if(!m)throw new VSError("Colours are written like #2962ff",l,c,"Use 6 hex digits after #, or a name such as blue or red.");push("color","#"+m[1].toLowerCase(),l,c);col+=m[0].length;i+=m[0].length;continue}
    const two=src.slice(i,i+2);if(["==","!=","<=",">=",":="].includes(two)){push("op",two==":="?"=":two,l,c);i+=2;col+=2;continue}
    if("+-*/%<>=?:(),[];".includes(ch)){push(ch===";"?"nl":"op",ch,l,c);i++;col++;continue}
    if(ch==="."){throw new VSError("\u201c.\u201d isn\u2019t allowed here",l,c,"Vektor Script has no object properties. Call functions directly, e.g. sma(close, 20).")}
    throw new VSError("Unexpected character \u201c"+ch+"\u201d",l,c)}
  push("eof","",line,col);return T}
// ---- parser (precedence climbing)
function vsParse(src){if(typeof src!=="string")throw new VSError("Script must be text");if(src.length>VS_LIM.src)throw new VSError("Script is too long ("+VS_LIM.src+" characters max)");
  const T=vsLex(src);let p=0,depth=0;const pk=()=>T[p],nx=()=>T[p++];
  const is=(t,v)=>T[p].t===t&&(v===undefined||T[p].v===v);
  const want=(t,v,hint)=>{if(!is(t,v)){const k=T[p];throw new VSError("Expected \u201c"+(v||t)+"\u201d"+(k.t==="eof"?" before the end of the script":" but found \u201c"+(k.t==="nl"?"end of line":k.v)+"\u201d"),k.line,k.col,hint)}return nx()};
  const deep=k=>{if(++depth>VS_LIM.depth)throw new VSError("Expression is nested too deeply",k.line,k.col,"Split it into a few named steps.")};
  function primary(){const k=pk();deep(k);let e;
    if(is("num")){nx();e={k:"num",v:k.v}}
    else if(is("str")){nx();e={k:"str",v:k.v}}
    else if(is("color")){nx();e={k:"str",v:k.v}}
    else if(is("kw","true")||is("kw","false")){nx();e={k:"num",v:k.v==="true"?1:0}}
    else if(is("kw","na")){nx();e={k:"num",v:NaN}}
    else if(is("op","(")){nx();e=expr();want("op",")",null)}
    else if(is("id")){nx();if(is("op","(")){nx();const args=[],kw=Object.create(null);
        if(!is("op",")"))for(;;){while(is("nl"))nx();if(is("id")&&T[p+1].t==="op"&&T[p+1].v==="="){const nm=nx().v;nx();kw[nm]=expr()}else args.push(expr());while(is("nl"))nx();if(is("op",",")){nx();continue}break}
        want("op",")","Close the call to "+k.v+"( with \u201c)\u201d.");e={k:"call",f:k.v,args,kw,line:k.line,col:k.col}}
      else e={k:"id",v:k.v,line:k.line,col:k.col}}
    else throw new VSError(k.t==="eof"?"The script ends in the middle of an expression":k.t==="nl"?"This line ends in the middle of an expression":"Unexpected \u201c"+k.v+"\u201d",k.line,k.col,k.t==="nl"||k.t==="eof"?"Finish the expression or remove the operator at the end of the line.":"");
    while(is("op","[")){const b=nx();const i=expr();want("op","]");e={k:"hist",e,i,line:b.line,col:b.col}}
    depth--;return e}
  function unary(){if(is("op","-")){const k=nx();return{k:"neg",e:unary(),line:k.line,col:k.col}}if(is("op","+")){nx();return unary()}if(is("kw","not")){const k=nx();return{k:"not",e:unary(),line:k.line,col:k.col}}return primary()}
  const BIN=[["or"],["and"],["==","!="],["<","<=",">",">="],["+","-"],["*","/","%"]];
  function bin(l){if(l>=BIN.length)return unary();let a=bin(l+1);for(;;){const k=pk();const op=(k.t==="op"||k.t==="kw")&&BIN[l].includes(k.v)?k.v:null;if(!op)return a;nx();a={k:"bin",op,a,b:bin(l+1),line:k.line,col:k.col}}}
  function expr(){const c=bin(0);if(is("op","?")){const k=nx();const a=expr();want("op",":",null);const b=expr();return{k:"tern",c,a,b,line:k.line,col:k.col}}return c}
  const prog=[];while(!is("eof")){if(is("nl")){nx();continue}const k=pk();
    if(prog.length>=VS_LIM.stmts)throw new VSError("Too many statements ("+VS_LIM.stmts+" max)",k.line,k.col);
    if(is("id")&&T[p+1].t==="op"&&T[p+1].v==="="){const nm=nx().v;nx();if(VS_SERIES.includes(nm)||vsOwn(VS_FN,nm)||["plot","hline","input","indicator"].includes(nm))throw new VSError("\u201c"+nm+"\u201d is a built-in name and can\u2019t be reassigned",k.line,k.col,"Pick another name, e.g. my_"+nm+".");
      prog.push({k:"set",n:nm,e:expr(),line:k.line,col:k.col})}else prog.push({k:"do",e:expr(),line:k.line,col:k.col});
    if(!is("eof")&&!is("nl")){const q=pk();throw new VSError("Expected a new line after this statement but found \u201c"+q.v+"\u201d",q.line,q.col,"Put each statement on its own line.")}}
  return prog}
// ---- runtime: series are Float64Arrays (NaN = na), scalars are numbers
const vsIsS=x=>x instanceof Float64Array;
function vsMap1(x,f,n){if(!vsIsS(x))return f(x);const o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=f(x[i]);return o}
function vsMap2(x,y,f,n){if(!vsIsS(x)&&!vsIsS(y))return f(x,y);const o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=f(vsIsS(x)?x[i]:x,vsIsS(y)?y[i]:y);return o}
function vsSer(x,n){if(vsIsS(x))return x;const o=new Float64Array(n);o.fill(typeof x==="number"?x:NaN);return o}
function vsLen(v,f,node){if(vsIsS(v))throw vsErr(node,f+"(): the length must be a number, not a series","Use a number or an input(), e.g. "+f+"(close, 14).");const k=Math.round(v);if(!(k>=1))throw vsErr(node,f+"(): the length must be 1 or more");if(k>VS_LIM.len)throw vsErr(node,f+"(): the length can be at most "+VS_LIM.len);return k}
function vsErr(node,msg,hint){return new VSError(msg,node&&node.line,node&&node.col,hint)}
function vsSMA(x,k,n){const o=new Float64Array(n).fill(NaN);let s=0,c=0;for(let i=0;i<n;i++){const v=x[i];if(isNaN(v)){s=0;c=0;continue}s+=v;c++;if(c>k){s-=x[i-k];c=k}if(c===k)o[i]=s/k}return o}
function vsEMA(x,k,n,alpha){const a=alpha||2/(k+1),o=new Float64Array(n).fill(NaN);let prev=NaN,seed=0,c=0;for(let i=0;i<n;i++){const v=x[i];if(isNaN(v))continue;
  if(isNaN(prev)){seed+=v;c++;if(c===k){prev=seed/k;o[i]=prev}continue}prev=a*v+(1-a)*prev;o[i]=prev}return o}
function vsWin(x,k,n,f){const o=new Float64Array(n).fill(NaN);for(let i=k-1;i<n;i++){let ok=true;const w=[];for(let j=i-k+1;j<=i;j++){if(isNaN(x[j])){ok=false;break}w.push(x[j])}if(ok)o[i]=f(w)}return o}
function vsShift(x,k,n){const o=new Float64Array(n).fill(NaN);for(let i=k;i<n;i++)o[i]=x[i-k];return o}
const VS_FN=Object.assign(Object.create(null),{
  sma:{a:2,sig:"sma(source, length)",f:(A,n,c)=>vsSMA(vsSer(A[0],n),vsLen(A[1],"sma",c),n)},
  ema:{a:2,sig:"ema(source, length)",f:(A,n,c)=>vsEMA(vsSer(A[0],n),vsLen(A[1],"ema",c),n)},
  rma:{a:2,sig:"rma(source, length)",f:(A,n,c)=>{const k=vsLen(A[1],"rma",c);return vsEMA(vsSer(A[0],n),k,n,1/k)}},
  wma:{a:2,sig:"wma(source, length)",f:(A,n,c)=>{const k=vsLen(A[1],"wma",c),d=k*(k+1)/2;return vsWin(vsSer(A[0],n),k,n,w=>w.reduce((s,v,i)=>s+v*(i+1),0)/d)}},
  stdev:{a:2,sig:"stdev(source, length)",f:(A,n,c)=>{const k=vsLen(A[1],"stdev",c);return vsWin(vsSer(A[0],n),k,n,w=>{const m=w.reduce((a,b)=>a+b,0)/k;return Math.sqrt(w.reduce((a,b)=>a+(b-m)*(b-m),0)/k)})}},
  highest:{a:2,sig:"highest(source, length)",f:(A,n,c)=>vsWin(vsSer(A[0],n),vsLen(A[1],"highest",c),n,w=>Math.max(...w))},
  lowest:{a:2,sig:"lowest(source, length)",f:(A,n,c)=>vsWin(vsSer(A[0],n),vsLen(A[1],"lowest",c),n,w=>Math.min(...w))},
  sum:{a:2,sig:"sum(source, length)",f:(A,n,c)=>vsWin(vsSer(A[0],n),vsLen(A[1],"sum",c),n,w=>w.reduce((a,b)=>a+b,0))},
  change:{a:[1,2],sig:"change(source, length = 1)",f:(A,n,c)=>{const x=vsSer(A[0],n),k=A.length>1?vsLen(A[1],"change",c):1,s=vsShift(x,k,n);return vsMap2(x,s,(a,b)=>a-b,n)}},
  roc:{a:2,sig:"roc(source, length)",f:(A,n,c)=>{const x=vsSer(A[0],n),s=vsShift(x,vsLen(A[1],"roc",c),n);return vsMap2(x,s,(a,b)=>b?(a/b-1)*100:NaN,n)}},
  rsi:{a:2,sig:"rsi(source, length)",f:(A,n,c)=>{const x=vsSer(A[0],n),k=vsLen(A[1],"rsi",c),o=new Float64Array(n).fill(NaN);let g=0,l=0;
    for(let i=1;i<n;i++){const d=x[i]-x[i-1],u=Math.max(d,0),w=Math.max(-d,0);if(i<=k){g+=u;l+=w;if(i===k){g/=k;l/=k;o[i]=l===0?100:100-100/(1+g/l)}}else{g=(g*(k-1)+u)/k;l=(l*(k-1)+w)/k;o[i]=l===0?100:100-100/(1+g/l)}}return o}},
  tr:{a:0,sig:"tr()",f:(A,n,c,E)=>{const o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=i?Math.max(E.high[i]-E.low[i],Math.abs(E.high[i]-E.close[i-1]),Math.abs(E.low[i]-E.close[i-1])):E.high[i]-E.low[i];return o}},
  atr:{a:1,sig:"atr(length)",f:(A,n,c,E)=>{const k=vsLen(A[0],"atr",c);return vsEMA(VS_FN.tr.f([],n,c,E),k,n,1/k)}},
  crossover:{a:2,sig:"crossover(a, b)",f:(A,n)=>{const x=vsSer(A[0],n),y=vsSer(A[1],n),o=new Float64Array(n);for(let i=1;i<n;i++)o[i]=x[i]>y[i]&&x[i-1]<=y[i-1]?1:0;return o}},
  crossunder:{a:2,sig:"crossunder(a, b)",f:(A,n)=>{const x=vsSer(A[0],n),y=vsSer(A[1],n),o=new Float64Array(n);for(let i=1;i<n;i++)o[i]=x[i]<y[i]&&x[i-1]>=y[i-1]?1:0;return o}},
  cum:{a:1,sig:"cum(source)",f:(A,n)=>{const x=vsSer(A[0],n),o=new Float64Array(n);let s=0;for(let i=0;i<n;i++){if(!isNaN(x[i]))s+=x[i];o[i]=s}return o}},
  nz:{a:[1,2],sig:"nz(source, replacement = 0)",f:(A,n)=>vsMap2(A[0],A.length>1?A[1]:0,(a,b)=>isNaN(a)?b:a,n)},
  abs:{a:1,sig:"abs(x)",f:(A,n)=>vsMap1(A[0],Math.abs,n)},sqrt:{a:1,sig:"sqrt(x)",f:(A,n)=>vsMap1(A[0],Math.sqrt,n)},log:{a:1,sig:"log(x)",f:(A,n)=>vsMap1(A[0],Math.log,n)},exp:{a:1,sig:"exp(x)",f:(A,n)=>vsMap1(A[0],Math.exp,n)},
  round:{a:[1,2],sig:"round(x, decimals = 0)",f:(A,n)=>{const d=Math.pow(10,A.length>1&&!vsIsS(A[1])?Math.max(0,Math.min(10,Math.round(A[1]))):0);return vsMap1(A[0],v=>Math.round(v*d)/d,n)}},
  floor:{a:1,sig:"floor(x)",f:(A,n)=>vsMap1(A[0],Math.floor,n)},ceil:{a:1,sig:"ceil(x)",f:(A,n)=>vsMap1(A[0],Math.ceil,n)},
  pow:{a:2,sig:"pow(x, y)",f:(A,n)=>vsMap2(A[0],A[1],Math.pow,n)},
  min:{a:2,sig:"min(a, b)",f:(A,n)=>vsMap2(A[0],A[1],(a,b)=>isNaN(a)||isNaN(b)?NaN:Math.min(a,b),n)},
  max:{a:2,sig:"max(a, b)",f:(A,n)=>vsMap2(A[0],A[1],(a,b)=>isNaN(a)||isNaN(b)?NaN:Math.max(a,b),n)},
  avg:{a:2,sig:"avg(a, b)",f:(A,n)=>vsMap2(A[0],A[1],(a,b)=>(a+b)/2,n)},
  isna:{a:1,sig:"isna(x)",f:(A,n)=>vsMap1(A[0],v=>isNaN(v)?1:0,n)},
});
const VS_DECL=["indicator","input","plot","hline"];
function vsLev(a,b){const m=[];for(let i=0;i<=b.length;i++)m[i]=[i];for(let j=0;j<=a.length;j++)m[0][j]=j;for(let i=1;i<=b.length;i++)for(let j=1;j<=a.length;j++)m[i][j]=Math.min(m[i-1][j]+1,m[i][j-1]+1,m[i-1][j-1]+(a[j-1]===b[i-1]?0:1));return m[b.length][a.length]}
function vsSuggest(w,pool){let best=null,bd=3;for(const p of pool){const d=vsLev(w.toLowerCase(),p);if(d<bd){bd=d;best=p}}return best}
function vsColor(v,node){if(typeof v!=="string")throw vsErr(node,"Colours are text like #2962ff or a name like blue");const s=v.toLowerCase();if(vsOwn(VS_COLORS,s))return VS_COLORS[s];if(/^#([0-9a-f]{6}|[0-9a-f]{3})$/.test(s))return s;
  throw vsErr(node,"Unknown colour \u201c"+v+"\u201d","Use #rrggbb or one of: "+Object.keys(VS_COLORS).slice(0,8).join(", ")+"\u2026")}
// run: bars = [{o,h,l,c,v,t}], inputs = {title: value}; returns {name, overlay, plots:[{title,color,width,style,v}], hlines, inputs:[...]}
function vsRun(src,bars,inputVals){const prog=typeof src==="string"?vsParse(src):src,n=bars.length,E=Object.create(null),V=Object.create(null);
  const col=k=>{const o=new Float64Array(n);for(let i=0;i<n;i++){const b=bars[i],v=b[k];o[i]=v==null?NaN:+v}return o};
  E.open=col("o");E.high=col("h");E.low=col("l");E.close=col("c");E.volume=col("v");E.time=col("t");
  for(let i=0;i<n;i++)if(isNaN(E.open[i]))E.open[i]=i?E.close[i-1]:E.close[i];
  E.hl2=vsMap2(E.high,E.low,(a,b)=>(a+b)/2,n);E.hlc3=new Float64Array(n);E.ohlc4=new Float64Array(n);E.bar_index=new Float64Array(n);
  for(let i=0;i<n;i++){E.hlc3[i]=(E.high[i]+E.low[i]+E.close[i])/3;E.ohlc4[i]=(E.open[i]+E.high[i]+E.low[i]+E.close[i])/4;E.bar_index[i]=i}
  const out={name:"",overlay:true,plots:[],hlines:[],inputs:[]};let nodes=0;const iv=inputVals||{};
  const str=(node,what)=>{const v=ev(node);if(typeof v!=="string")throw vsErr(node,what+" must be text in quotes");return v};
  const scal=(node,what)=>{const v=ev(node);if(typeof v!=="number")throw vsErr(node,what+" must be a plain number");return v};
  function ev(x){if(++nodes>VS_LIM.nodes)throw vsErr(x,"The script is doing too much work","Use shorter lengths or fewer steps.");
    switch(x.k){case"num":return x.v;case"str":return x.v;
      case"id":{if(vsOwn(V,x.v))return V[x.v];if(vsOwn(E,x.v))return E[x.v];if(vsOwn(VS_COLORS,x.v))return x.v;
        const sg=vsSuggest(x.v,[...Object.keys(V),...VS_SERIES,...Object.keys(VS_FN)]);
        throw vsErr(x,"Unknown name \u201c"+x.v+"\u201d",sg?"Did you mean \u201c"+sg+"\u201d?":"Names must be assigned before use, e.g. fast = ema(close, 12). Built-in series: "+VS_SERIES.slice(0,8).join(", ")+".")}
      case"neg":{const v=ev(x.e);if(typeof v==="string")throw vsErr(x,"Can\u2019t negate text");return vsMap1(v,a=>-a,n)}
      case"not":{const v=ev(x.e);return vsMap1(v,a=>isNaN(a)?NaN:a?0:1,n)}
      case"bin":{const a=ev(x.a),b=ev(x.b);if(typeof a==="string"||typeof b==="string")throw vsErr(x,"\u201c"+x.op+"\u201d works on numbers and series, not text");
        const F={"+":(p,q)=>p+q,"-":(p,q)=>p-q,"*":(p,q)=>p*q,"/":(p,q)=>q===0?NaN:p/q,"%":(p,q)=>q===0?NaN:p%q,"<":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p<q),"<=":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p<=q),">":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p>q),">=":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p>=q),"==":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p===q),"!=":(p,q)=>isNaN(p)||isNaN(q)?NaN:+(p!==q),"and":(p,q)=>+(!!p&&!isNaN(p)&&!!q&&!isNaN(q)),"or":(p,q)=>+((!!p&&!isNaN(p))||(!!q&&!isNaN(q)))}[x.op];
        return vsMap2(a,b,F,n)}
      case"tern":{const c=ev(x.c),a=ev(x.a),b=ev(x.b);if(!vsIsS(c)&&!vsIsS(a)&&!vsIsS(b))return c&&!isNaN(c)?a:b;const C=vsSer(c,n),A=vsSer(a,n),B=vsSer(b,n),o=new Float64Array(n);for(let i=0;i<n;i++)o[i]=C[i]&&!isNaN(C[i])?A[i]:B[i];return o}
      case"hist":{const v=ev(x.e),k=ev(x.i);if(vsIsS(k))throw vsErr(x,"The number in [ ] must be a plain number, e.g. close[1]");const kk=Math.round(k);if(!(kk>=0)||kk>VS_LIM.len)throw vsErr(x,"[ ] looks back 0 to "+VS_LIM.len+" bars");return vsIsS(v)?vsShift(v,kk,n):v}
      case"call":return call(x)}
    throw vsErr(x,"Unsupported expression")}
  function call(x){const f=x.f;
    if(f==="indicator"){if(x.args.length)out.name=str(x.args[0],"The indicator name").slice(0,60);if(x.kw.overlay)out.overlay=!!scal(x.kw.overlay,"overlay");for(const k in x.kw)if(k!=="overlay")throw vsErr(x,"indicator() has no option \u201c"+k+"\u201d","Options: overlay=true or overlay=false.");return 0}
    if(f==="input"){if(!x.args.length)throw vsErr(x,"input() needs a default value","e.g. len = input(14, \"Length\")");const d=scal(x.args[0],"The default value");const t=x.args[1]?str(x.args[1],"The input title"):"Input "+(out.inputs.length+1);
      const mn=x.kw.min?scal(x.kw.min,"min"):-1e12,mx=x.kw.max?scal(x.kw.max,"max"):1e12;let v=iv[t]!=null&&isFinite(+iv[t])?+iv[t]:d;v=Math.max(mn,Math.min(mx,v));out.inputs.push({title:t,def:d,min:mn,max:mx,v});return v}
    if(f==="plot"){if(out.plots.length>=VS_LIM.plots)throw vsErr(x,"Too many plots ("+VS_LIM.plots+" max)");if(!x.args.length)throw vsErr(x,"plot() needs a series","e.g. plot(ema(close, 20), \"EMA\")");
      const v=vsSer(ev(x.args[0]),n),title=x.args[1]?str(x.args[1],"The plot title"):"Plot "+(out.plots.length+1);
      const color=vsColor(x.kw.color?ev(x.kw.color):x.args[2]?ev(x.args[2]):["#2962ff","#fb923c","#9c27b0","#089981","#f23645"][out.plots.length%5],x);
      const width=x.kw.width?Math.max(1,Math.min(4,Math.round(scal(x.kw.width,"width")))):2,style=x.kw.style?str(x.kw.style,"style"):"line";
      if(!["line","histogram","area"].includes(style))throw vsErr(x,"Unknown plot style \u201c"+style+"\u201d","Use \"line\", \"histogram\" or \"area\".");
      for(const k in x.kw)if(!["color","width","style"].includes(k))throw vsErr(x,"plot() has no option \u201c"+k+"\u201d","Options: color, width, style.");
      out.plots.push({title,color,width,style,v});return 0}
    if(f==="hline"){if(out.hlines.length>=VS_LIM.hlines)throw vsErr(x,"Too many hlines ("+VS_LIM.hlines+" max)");const v=scal(x.args[0]||{k:"num",v:NaN,line:x.line,col:x.col},"hline() value");
      out.hlines.push({v,title:x.args[1]?str(x.args[1],"The line title"):"",color:vsColor(x.kw.color?ev(x.kw.color):"gray",x)});return 0}
    const F=vsOwn(VS_FN,f)?VS_FN[f]:null;if(!F){const sg=vsSuggest(f,[...Object.keys(VS_FN),...VS_DECL]);throw vsErr(x,"Unknown function \u201c"+f+"()\u201d",sg?"Did you mean \u201c"+sg+"()\u201d?":"See the function list in the help panel.")}
    const want=Array.isArray(F.a)?F.a:[F.a,F.a];for(const k in x.kw)throw vsErr(x,f+"() doesn\u2019t take named options","Write it as "+F.sig+".");
    if(x.args.length<want[0]||x.args.length>want[1])throw vsErr(x,f+"() takes "+(want[0]===want[1]?want[0]:want[0]+" or "+want[1])+" value"+(want[1]===1?"":"s")+", got "+x.args.length,"Write it as "+F.sig+".");
    const A=x.args.map(a=>{const v=ev(a);if(typeof v==="string")throw vsErr(a,f+"() works on numbers and series, not text");return v});return F.f(A,n,x,E)}
  for(const st of prog){if(st.k==="set")V[st.n]=ev(st.e);else ev(st.e)}
  if(!out.plots.length&&!out.hlines.length)throw new VSError("Nothing to show: add a plot(...) line",0,0,"e.g. plot(ema(close, 20), \"EMA 20\")");
  return out}
// ---------- Vektor Script: editor, chart plotting, import/export ----------
// Scripts live with your other settings (scr2: S.vs). Enabled scripts are drawn on the main chart (Workspace and
// Supercharts): overlay scripts on the price scale, the others in stacked bands at the bottom of the chart.
const VS_EX=[
 {name:"MACD",src:`indicator("MACD", overlay=false)\nfast = input(12, "Fast length", min=1, max=200)\nslow = input(26, "Slow length", min=1, max=400)\nsignal_len = input(9, "Signal length", min=1, max=100)\nmacd = ema(close, fast) - ema(close, slow)\nsignal = ema(macd, signal_len)\nplot(macd - signal, "Histogram", color=gray, style="histogram")\nplot(macd, "MACD", color=blue)\nplot(signal, "Signal", color=orange)\nhline(0, "Zero")`},
 {name:"RSI with bands",src:`indicator("RSI", overlay=false)\nlen = input(14, "Length", min=2, max=200)\nr = rsi(close, len)\nplot(r, "RSI", color=purple)\nhline(70, "Upper", color=red)\nhline(30, "Lower", color=green)`},
 {name:"Bollinger Bands",src:`indicator("Bollinger Bands", overlay=true)\nlen = input(20, "Length", min=2, max=400)\nmult = input(2, "StdDev", min=0.5, max=5)\nbasis = sma(close, len)\ndev = mult * stdev(close, len)\nplot(basis, "Basis", color=orange)\nplot(basis + dev, "Upper", color=blue, width=1)\nplot(basis - dev, "Lower", color=blue, width=1)`},
 {name:"Stochastic",src:`indicator("Stochastic", overlay=false)\nk_len = input(14, "%K length", min=1, max=200)\nd_len = input(3, "%D smoothing", min=1, max=50)\nlo = lowest(low, k_len)\nhi = highest(high, k_len)\nk = hi - lo == 0 ? 50 : 100 * (close - lo) / (hi - lo)\nd = sma(k, d_len)\nplot(k, "%K", color=blue)\nplot(d, "%D", color=orange)\nhline(80, "Upper")\nhline(20, "Lower")`},
 {name:"EMA cross",src:`indicator("EMA cross", overlay=true)\nfast_len = input(9, "Fast", min=1, max=200)\nslow_len = input(21, "Slow", min=1, max=400)\nfast = ema(close, fast_len)\nslow = ema(close, slow_len)\nplot(fast, "Fast EMA", color=teal)\nplot(slow, "Slow EMA", color=red)`},
 {name:"Keltner channel (ATR)",src:`indicator("Keltner channel", overlay=true)\nlen = input(20, "Length", min=2, max=400)\nmult = input(1.5, "ATR multiple", min=0.1, max=10)\nmid = ema(close, len)\nband = mult * atr(len)\nplot(mid, "Middle", color=gray)\nplot(mid + band, "Upper", color=teal, width=1)\nplot(mid - band, "Lower", color=teal, width=1)`},
 {name:"Rate of change",src:`indicator("Rate of change", overlay=false)\nlen = input(10, "Length", min=1, max=400)\nplot(roc(close, len), "ROC %", color=blue)\nhline(0, "Zero")`},
];
const VS_MAX_SCRIPTS=50,VS_IMPORT_MAX=512*1024;
const VSUI={sel:null,ser:[],errs:{},cache:new Map(),live:0};
function vsCfg(){if(!S.vs||typeof S.vs!=="object"||Array.isArray(S.vs))S.vs={};if(!Array.isArray(S.vs.list))S.vs.list=[];return S.vs}
function vsNew(name,src){const C=vsCfg();if(C.list.length>=VS_MAX_SCRIPTS){toast("You can keep up to "+VS_MAX_SCRIPTS+" scripts");return null}
  const sc={id:vtNextId("vs"),name:String(name||"My script").slice(0,60),src:String(src||`indicator("My script", overlay=true)\nplot(ema(close, 20), "EMA 20", color=orange)`).slice(0,VS_LIM.src),on:false,inp:{}};C.list.push(sc);save();return sc}
function vsGet(id){return vsCfg().list.find(x=>x.id===id)||null}
// sanitise one imported script: only the known fields, as plain text/numbers
function vsClean(o){if(!o||typeof o!=="object"||typeof o.src!=="string"||o.src.length>VS_LIM.src)return null;const inp={};
  if(o.inp&&typeof o.inp==="object")for(const k of Object.keys(o.inp).slice(0,30))if(typeof k==="string"&&k.length<=80&&isFinite(+o.inp[k]))inp[k]=+o.inp[k];
  return{name:String(typeof o.name==="string"?o.name:"Imported script").slice(0,60),src:o.src,inp}}
function vsExport(list){const data={format:"vektor-script",version:1,exported:new Date().toISOString(),scripts:list.map(s=>({name:s.name,src:s.src,inp:s.inp||{}}))};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  a.download=(list.length===1?list[0].name.replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-|-$/g,"")||"script":"vektor-scripts")+".vks.json";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);return data}
// accepts our export format, a single {name,src}, or plain script text (.vks/.txt); returns {added, skipped, errors[]}
function vsImportText(txt,fname){const res={added:0,skipped:0,errors:[]};if(typeof txt!=="string"||txt.length>VS_IMPORT_MAX){res.errors.push("File is too large (512 KB max)");return res}
  let items=null;const t=txt.trim();
  if(t.startsWith("{")||t.startsWith("[")){let j;try{j=JSON.parse(t)}catch(e){res.errors.push("This isn\u2019t valid JSON: "+e.message);return res}
    items=Array.isArray(j)?j:j&&Array.isArray(j.scripts)?j.scripts:[j]}else items=[{name:String(fname||"Imported script").replace(/\.(vks|txt)$/i,""),src:txt}];
  for(const it of items.slice(0,VS_MAX_SCRIPTS)){const c=vsClean(it);if(!c){res.skipped++;continue}try{vsParse(c.src)}catch(e){res.errors.push((c.name||"Script")+": line "+e.line+": "+e.message)}
    const sc=vsNew(c.name,c.src);if(!sc){res.skipped++;continue}sc.inp=c.inp;res.added++}
  if(items.length>VS_MAX_SCRIPTS)res.skipped+=items.length-VS_MAX_SCRIPTS;save();return res}
// ---- run on bars (cached by source, inputs and the data)
function vsBarsKey(a){const z=a[a.length-1];return a.length+"|"+(z&&z.t)+"|"+(z&&z.c)+"|"+(z&&z.h)+"|"+(z&&z.l)}
function vsCompute(sc,a){const key=sc.src+"\u0000"+JSON.stringify(sc.inp||{})+"\u0000"+vsBarsKey(a);const c=VSUI.cache.get(sc.id);if(c&&c.key===key)return c.r;
  let r;try{r={ok:vsRun(sc.src,a,sc.inp||{})}}catch(e){r={err:e instanceof VSError?e:new VSError(String(e&&e.message||e))}}VSUI.cache.set(sc.id,{key,r});return r}
function vsFmtErr(e){return(e.line?"Line "+e.line+(e.col?", column "+e.col:"")+": ":"")+e.message+(e.hint?" "+e.hint:"")}
// ---- plotting on the main chart
function vsPlot(s,a,T){VSUI.ser=[];if(typeof ch==="undefined"||!ch||!a||!a.length)return;const on=vsCfg().list.filter(x=>x.on);if(!on.length){vsLegend(on);return}
  const res=on.map(sc=>({sc,r:vsCompute(sc,a)}));const osc=res.filter(x=>x.r.ok&&!x.r.ok.overlay),band=Math.min(.24,.5/Math.max(1,osc.length));
  if(osc.length)try{ch.priceScale("right").applyOptions({scaleMargins:{top:.06,bottom:Math.min(.6,band*osc.length+.04)}})}catch(e){}
  res.forEach(({sc,r})=>{VSUI.errs[sc.id]=r.err||null;if(!r.ok)return;const R=r.ok,j=osc.findIndex(x=>x.sc===sc);
    const scale=R.overlay?"right":"vs_"+sc.id,refs=[];
    R.plots.forEach((p,pi)=>{const o={color:p.color,lineWidth:p.width,priceLineVisible:false,lastValueVisible:!R.overlay,crosshairMarkerVisible:false,priceScaleId:scale,title:""};
      const ser=p.style==="histogram"?ch.addHistogramSeries({color:p.color,priceScaleId:scale,priceLineVisible:false,lastValueVisible:false}):p.style==="area"?ch.addAreaSeries({lineColor:p.color,topColor:p.color+"55",bottomColor:p.color+"05",lineWidth:p.width,priceScaleId:scale,priceLineVisible:false,lastValueVisible:false}):ch.addLineSeries(o);
      if(!R.overlay)try{ch.priceScale(scale).applyOptions({scaleMargins:{top:1-band*(j+1)+.01,bottom:band*j+.01},borderVisible:false})}catch(e){}
      ser.setData(vsPts(p.v,T));refs.push({ser,pi});if(pi===0)R.hlines.forEach(h=>{if(isFinite(h.v))ser.createPriceLine({price:h.v,color:h.color,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:h.title||""})})});
    VSUI.ser.push({sc,refs,key:vsBarsKey(a)})});vsLegend(on)}
function vsPts(v,T){const o=[];for(let i=0;i<v.length;i++){const y=v[i];if(isFinite(y))o.push({time:T(i),value:y})}return o}
// small legend at the bottom-left of the chart: one chip per active script (errors shown there too)
function vsLegend(on){const host=document.getElementById("cv");if(!host)return;let L=document.getElementById("vsleg");if(!on.length){if(L)L.remove();return}
  if(!L||!host.parentElement.contains(L)){L=document.createElement("div");L.id="vsleg";L.className="vsleg";host.parentElement.appendChild(L)}
  const warnSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>';
  L.innerHTML=on.map(sc=>{const e=VSUI.errs[sc.id];return`<button type="button" class="vschip${e?" err":""}" data-id="${esc(sc.id)}" title="${e?esc(vsFmtErr(e)):"Edit script"}">${e?warnSvg:""}${esc(sc.name)}</button>`}).join("");
  L.querySelectorAll(".vschip").forEach(b=>b.onclick=()=>vsM(b.dataset.id))}
// live: recompute when the last bar changes and update only the last points
setInterval(()=>{if(document.hidden||!VSUI.ser.length||typeof ch==="undefined"||!ch)return;const s=symOf(S.chart.sym);if(!s)return;const a=candles(s,S.chart.tf);if(!a||!a.length)return;const k=vsBarsKey(a);
  for(const e of VSUI.ser){if(e.key===k)continue;const prevLen=+e.key.split("|")[0];if(a.length!==prevLen){if(typeof drawChart==="function")drawChart();return}
    e.key=k;const r=vsCompute(e.sc,a);if(!r.ok)continue;const st=STEP[S.chart.tf]||3600,z=a[a.length-1],t=z.t||Math.floor(Date.now()/1000/st)*st;
    e.refs.forEach(({ser,pi})=>{const v=r.ok.plots[pi]&&r.ok.plots[pi].v[a.length-1];if(isFinite(v))try{ser.update({time:t,value:v})}catch(x){}})}},1000);
if(typeof vtAfterDraw==="function"){const _vsAD=vtAfterDraw;vtAfterDraw=function(s,a,T){const r=_vsAD.apply(this,arguments);try{vsBtn();vsPlot(s,a,T)}catch(e){console.error(e)}return r}}
function vsBtn(){const s=document.querySelector('#cp .cpb .row.top button[onclick="setM()"]');if(!s||document.getElementById("vsb"))return;
  const b=document.createElement("button");b.id="vsb";b.type="button";b.className=s.className;b.textContent="Scripts";b.title="Custom indicator scripts";b.setAttribute("aria-haspopup","dialog");b.onclick=()=>vsM();(document.getElementById("tplb")||s).after(b)}
// ---- editor
function vsHelpHTML(){return`<details class="vshelp"><summary>Language help</summary><div class="vshb">
<p><b>Lines:</b> <code>name = expression</code>, or a call such as <code>plot(...)</code>. <code>//</code> starts a comment.</p>
<p><b>Declare:</b> <code>indicator("Name", overlay=true)</code> (overlay=false draws in its own band), <code>input(14, "Length", min=1, max=200)</code>, <code>plot(series, "Title", color=blue, width=2, style="line" | "histogram" | "area")</code>, <code>hline(70, "Upper", color=red)</code>.</p>
<p><b>Series:</b> ${VS_SERIES.map(x=>`<code>${x}</code>`).join(" ")}. <b>Past values:</b> <code>close[1]</code> is the previous bar.</p>
<p><b>Operators:</b> <code>+ - * / %</code>, <code>${esc("< <= > >= == !=")}</code>, <code>and or not</code>, <code>condition ? a : b</code>. <code>na</code> is a missing value.</p>
<p><b>Functions:</b> ${Object.keys(VS_FN).map(k=>`<code title="${esc(VS_FN[k].sig)}">${esc(VS_FN[k].sig)}</code>`).join(" ")}</p>
<p><b>Colours:</b> <code>#2962ff</code> or ${Object.keys(VS_COLORS).map(c=>`<code>${c}</code>`).join(" ")}</p>
<p class="mut">Scripts run inside the app\u2019s own interpreter. They can only read the chart\u2019s candles and draw lines; they can\u2019t open pages, send data or read storage. Results are calculations on past prices, not advice.</p></div></details>`}
function vsM(id){const C=vsCfg();if(id&&vsGet(id))VSUI.sel=id;if(!VSUI.sel||!vsGet(VSUI.sel))VSUI.sel=C.list[0]?C.list[0].id:null;const sc=VSUI.sel?vsGet(VSUI.sel):null;
  const li=x=>`<li><button type="button" class="vsli${x.id===VSUI.sel?" on":""}" data-id="${esc(x.id)}" aria-current="${x.id===VSUI.sel}">${x.on?'<span class="vsdot" aria-hidden="true"></span>':""}${esc(x.name)}${x.on?'<span class="vh">(on chart)</span>':""}</button></li>`;
  const xSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  modal(`<div class="vsm"><div class="vshd"><h3 id="vs_t">Indicator scripts</h3><span class="mut">Vektor Script</span><span class="sp"></span><button type="button" class="ibtn" aria-label="Close" onclick="closeM()">${xSvg}</button></div>
<div class="vsbody"><aside class="vsside"><h4>My scripts</h4>${C.list.length?`<ul class="vsl">${C.list.map(li).join("")}</ul>`:`<p class="mut">None yet. Start from an example or a blank script.</p>`}
<div class="vsbtns"><button type="button" id="vs_new">New</button><button type="button" id="vs_imp">Import\u2026</button><input type="file" id="vs_file" accept=".json,.vks,.txt,application/json,text/plain" hidden>${C.list.length?`<button type="button" id="vs_expall">Export all</button>`:""}</div>
<h4>Examples</h4><ul class="vsl">${VS_EX.map((x,i)=>`<li><button type="button" class="vsex" data-i="${i}" title="Add a copy to My scripts">${esc(x.name)}</button></li>`).join("")}</ul></aside>
<section class="vsmain">${sc?`<div class="vsrow"><label class="vsname">Name<input id="vs_name" maxlength="60" value="${esc(sc.name)}" autocomplete="off"></label>
<button type="button" id="vs_tog" class="${sc.on?"":"pri"}" aria-pressed="${!!sc.on}">${sc.on?"Remove from chart":"Add to chart"}</button></div>
<div class="vsed"><pre class="vsgut" id="vs_gut" aria-hidden="true"></pre><textarea id="vs_src" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Script source" aria-describedby="vs_msg">${esc(sc.src)}</textarea></div>
<div id="vs_msg" class="vsmsg" role="status" aria-live="polite"></div><div id="vs_inp" class="vsinp"></div>
<div class="vsrow"><button type="button" id="vs_chk">Check</button><button type="button" id="vs_save" class="pri">Save</button><span class="sp"></span><button type="button" id="vs_dup">Duplicate</button><button type="button" id="vs_exp">Export</button><button type="button" id="vs_del" class="vsdanger">Delete</button></div>`
:`<div class="vsempty"><p>Write your own indicators in a small, safe language and draw them on the chart.</p><p class="mut">Pick an example on the left to get started, or create a blank script.</p></div>`}
${vsHelpHTML()}</section></div></div>`);
  const box=MD.querySelector(".box");if(box)box.setAttribute("aria-labelledby","vs_t");const q=s=>document.getElementById(s);
  MD.querySelectorAll(".vsli").forEach(b=>b.onclick=()=>{vsStash();vsM(b.dataset.id)});
  MD.querySelectorAll(".vsex").forEach(b=>b.onclick=()=>{vsStash();const x=VS_EX[+b.dataset.i],n=vsNew(x.name,x.src);if(n){vsM(n.id);vsCheck(true)}});
  q("vs_new").onclick=()=>{vsStash();const n=vsNew("My script");if(n)vsM(n.id)};
  q("vs_imp").onclick=()=>q("vs_file").click();
  q("vs_file").onchange=e=>{const f=e.target.files&&e.target.files[0];if(!f)return;if(f.size>VS_IMPORT_MAX){vsMsg("File is too large (512 KB max)",true);return}
    const rd=new FileReader();rd.onload=()=>{const r=vsImportText(String(rd.result),f.name);const last=vsCfg().list[vsCfg().list.length-1];if(r.added)vsM(last.id);
      vsMsg(r.added?"Imported "+r.added+" script"+(r.added===1?"":"s")+(r.skipped?", skipped "+r.skipped:"")+(r.errors.length?". Check: "+r.errors.join("; "):"."):"Nothing imported. "+(r.errors.join("; ")||"The file has no scripts."),!r.added||r.errors.length>0)};rd.readAsText(f)};
  if(q("vs_expall"))q("vs_expall").onclick=()=>{vsStash();vsExport(vsCfg().list)};
  if(!sc){vsFocus();return}
  const ta=q("vs_src"),gut=q("vs_gut");const lines=()=>{const n=ta.value.split("\n").length;let h="";for(let i=1;i<=n;i++)h+=i+"\n";gut.textContent=h};lines();
  ta.addEventListener("input",()=>{lines();clearTimeout(VSUI.t);VSUI.t=setTimeout(()=>vsCheck(false),500)});ta.addEventListener("scroll",()=>{gut.scrollTop=ta.scrollTop});
  ta.addEventListener("keydown",e=>{if(e.key==="Tab"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!VSUI.tabOut){e.preventDefault();const a=ta.selectionStart,b=ta.selectionEnd;ta.setRangeText("  ",a,b,"end");lines()}
    else if(e.key==="Escape"){VSUI.tabOut=true;setTimeout(()=>VSUI.tabOut=false,1500)}
    else if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();e.stopPropagation();vsSave()}
    else if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();vsCheck(true)}});
  q("vs_chk").onclick=()=>vsCheck(true);q("vs_save").onclick=()=>vsSave();
  q("vs_tog").onclick=()=>{vsSave(true);const c=vsCheck(true);if(!sc.on&&!c){vsMsg("Fix the error above before adding it to the chart.",true);return}sc.on=!sc.on;save();vsRedraw();vsM(sc.id);vsMsg(sc.on?"Added to the chart.":"Removed from the chart.")};
  q("vs_dup").onclick=()=>{vsSave(true);const n=vsNew(sc.name+" (copy)",sc.src);if(n){n.inp=Object.assign({},sc.inp);save();vsM(n.id)}};
  q("vs_exp").onclick=()=>{vsSave(true);vsExport([sc])};
  q("vs_del").onclick=()=>{if(!confirm("Delete \u201c"+sc.name+"\u201d?"))return;const L=vsCfg().list,i=L.indexOf(sc);if(i>=0)L.splice(i,1);VSUI.cache.delete(sc.id);VSUI.sel=null;save();if(sc.on)vsRedraw();vsM()};
  q("vs_name").addEventListener("change",()=>vsSave(true));
  vsCheck(false);vsFocus()}
function vsFocus(){const f=document.getElementById("vs_src")||MD.querySelector(".vsex");if(f)f.focus({preventScroll:true})}
function vsStash(){const ta=document.getElementById("vs_src"),sc=VSUI.sel&&vsGet(VSUI.sel);if(ta&&sc&&ta.value!==sc.src){sc.src=ta.value.slice(0,VS_LIM.src);save()}}
function vsSave(quiet){const sc=vsGet(VSUI.sel);if(!sc)return;const ta=document.getElementById("vs_src"),nm=document.getElementById("vs_name");
  if(ta)sc.src=ta.value.slice(0,VS_LIM.src);if(nm&&nm.value.trim())sc.name=nm.value.trim().slice(0,60);save();VSUI.cache.delete(sc.id);
  if(sc.on)vsRedraw();clearTimeout(VSUI.t);if(!quiet){const ok=vsCheck(true);if(ok)vsMsg("Saved."+(sc.on?" The chart is updated.":""));else{const m=document.getElementById("vs_msg");if(m)m.insertBefore(document.createTextNode("Saved, but there is an error. "),m.firstChild)}const b=MD.querySelector('.vsli[data-id="'+sc.id+'"]');if(b)b.childNodes.forEach(n=>{if(n.nodeType===3)n.textContent=sc.name})}}
function vsRedraw(){if(typeof drawChart==="function"&&typeof chartOnPage==="function"&&chartOnPage())drawChart()}
function vsMsg(t,err){const m=document.getElementById("vs_msg");if(!m)return;m.className="vsmsg"+(err?" err":" ok");m.textContent=t}
// check the editor text against the current chart's candles; shows the error with a "Go to line" button, or the inputs and last values
function vsCheck(show,keepInputs){const ta=document.getElementById("vs_src"),sc=vsGet(VSUI.sel);if(!ta||!sc)return false;const s=symOf(S.chart.sym)||SYMS[0];const a=(s&&candles(s,S.chart.tf))||[];
  const bars=a.length?a:Array.from({length:60},(_,i)=>({t:i*60,o:100,h:101,l:99,c:100+Math.sin(i/5),v:1}));
  let r;try{r=vsRun(ta.value,bars,sc.inp||{})}catch(e){const er=e instanceof VSError?e:new VSError(String(e&&e.message||e));const m=document.getElementById("vs_msg");
    m.className="vsmsg err";m.textContent="";const sp=document.createElement("span");sp.textContent=vsFmtErr(er);m.appendChild(sp);
    if(er.line){const b=document.createElement("button");b.type="button";b.className="lnk";b.textContent="Go to line "+er.line;b.onclick=()=>vsGoto(er.line,er.col);m.appendChild(b)}
    document.getElementById("vs_inp").innerHTML="";return false}
  const last=r.plots.map(p=>{let v=NaN;for(let i=p.v.length-1;i>=0;i--)if(isFinite(p.v[i])){v=p.v[i];break}return esc(p.title)+" "+(isFinite(v)?(Math.abs(v)>=1000?v.toFixed(0):v.toFixed(Math.abs(v)<1?4:2)):"\u2013")});
  if(show||document.getElementById("vs_msg").classList.contains("err"))vsMsg("No errors. "+r.plots.length+" plot"+(r.plots.length===1?"":"s")+(r.hlines.length?", "+r.hlines.length+" line"+(r.hlines.length===1?"":"s"):"")+", "+(r.overlay?"drawn over the price":"drawn in its own band")+". Last values"+(a.length?" on "+S.chart.sym+" "+S.chart.tf:" (sample bars)")+": "+last.join(", ")+".");
  const box=document.getElementById("vs_inp");if(keepInputs&&box.querySelector("input"))return true;box.innerHTML=r.inputs.length?`<fieldset><legend>Inputs</legend>${r.inputs.map((x,i)=>`<label>${esc(x.title)}<input type="number" step="any" data-t="${esc(x.title)}" value="${x.v}" ${x.min>-1e12?`min="${x.min}"`:""} ${x.max<1e12?`max="${x.max}"`:""}></label>`).join("")}</fieldset>`:"";
  box.querySelectorAll("input").forEach(inp=>inp.onchange=()=>{const v=+inp.value;if(!isFinite(v))return;sc.inp=sc.inp||{};sc.inp[inp.dataset.t]=v;save();VSUI.cache.delete(sc.id);if(sc.on)vsRedraw();vsCheck(true,true)});return true}
function vsGoto(line,col){const ta=document.getElementById("vs_src");if(!ta)return;const L=ta.value.split("\n");let p=0;for(let i=0;i<line-1&&i<L.length;i++)p+=L[i].length+1;p+=Math.max(0,(col||1)-1);
  ta.focus();ta.setSelectionRange(p,Math.min(ta.value.length,p+Math.max(1,(L[line-1]||"").length-(col||1)+1)));const lh=parseFloat(getComputedStyle(ta).lineHeight)||18;ta.scrollTop=Math.max(0,(line-3)*lh)}
