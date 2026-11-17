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
    if(is("op","[")){
      nx();const names=[];
      while(!is("op","]")&&!is("eof")){
        while(is("nl"))nx();
        if(is("id")){const nm=nx().v;if(VS_SERIES.includes(nm)||vsOwn(VS_FN,nm)||["plot","hline","input","indicator"].includes(nm))throw new VSError("\u201c"+nm+"\u201d is a built-in name and can\u2019t be reassigned",k.line,k.col);names.push(nm)}
        while(is("nl"))nx();
        if(is("op",",")){nx();continue}
        break;
      }
      want("op","]","Close bracket ] in destructuring assignment");
      want("op","=","Expected = after [a, b, ...]");
      prog.push({k:"destruct",names,e:expr(),line:k.line,col:k.col});
    }
    else if(is("id")&&T[p+1].t==="op"&&T[p+1].v==="="){const nm=nx().v;nx();if(VS_SERIES.includes(nm)||vsOwn(VS_FN,nm)||["plot","hline","input","indicator"].includes(nm))throw new VSError("\u201c"+nm+"\u201d is a built-in name and can\u2019t be reassigned",k.line,k.col,"Pick another name, e.g. my_"+nm+".");
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
  macd:{a:[1,4],sig:"macd(source, fast = 12, slow = 26, signal = 9)",f:(A,n,c)=>{
    const src=vsSer(A[0],n),f=A.length>1?vsLen(A[1],"macd",c):12,s=A.length>2?vsLen(A[2],"macd",c):26,sig=A.length>3?vsLen(A[3],"macd",c):9;
    const fE=vsEMA(src,f,n),sE=vsEMA(src,s,n),m=vsMap2(fE,sE,(a,b)=>a-b,n),sl=vsEMA(m,sig,n),h=vsMap2(m,sl,(a,b)=>a-b,n);
    const r=[m,sl,h];r.macd=m;r.signal=sl;r.hist=h;return r}},
  bb:{a:[1,3],sig:"bb(source, length = 20, mult = 2)",f:(A,n,c)=>{
    const src=vsSer(A[0],n),k=A.length>1?vsLen(A[1],"bb",c):20,mult=A.length>2&&!vsIsS(A[2])?+A[2]:2;
    const mid=vsSMA(src,k,n),dev=vsWin(src,k,n,w=>{const m=w.reduce((a,b)=>a+b,0)/k;return Math.sqrt(w.reduce((a,b)=>a+(b-m)*(b-m),0)/k)});
    const up=vsMap2(mid,dev,(m,d)=>m+mult*d,n),lo=vsMap2(mid,dev,(m,d)=>m-mult*d,n);
    const r=[mid,up,lo];r.mid=mid;r.upper=up;r.lower=lo;return r}},
  vwap:{a:[0,1],sig:"vwap(source = hlc3)",f:(A,n,c,E)=>{
    const src=A.length>0?vsSer(A[0],n):E.hlc3,v=E.volume,o=new Float64Array(n);
    let sPv=0,sV=0;for(let i=0;i<n;i++){const vol=isNaN(v[i])?1:v[i],p=isNaN(src[i])?0:src[i];sPv+=p*vol;sV+=vol;o[i]=sV>0?sPv/sV:p}return o}},
  stoch:{a:4,sig:"stoch(close, high, low, length)",f:(A,n,c)=>{
    const cl=vsSer(A[0],n),hi=vsSer(A[1],n),lo=vsSer(A[2],n),k=vsLen(A[3],"stoch",c),o=new Float64Array(n).fill(NaN);
    for(let i=k-1;i<n;i++){let minL=Infinity,maxH=-Infinity;for(let j=i-k+1;j<=i;j++){if(lo[j]<minL)minL=lo[j];if(hi[j]>maxH)maxH=hi[j]}const rng=maxH-minL;o[i]=rng===0?50:((cl[i]-minL)/rng)*100}return o}},
  cci:{a:[1,2],sig:"cci(source = hlc3, length = 20)",f:(A,n,c,E)=>{
    const src=A.length>0?vsSer(A[0],n):E.hlc3,k=A.length>1?vsLen(A[1],"cci",c):20,ma=vsSMA(src,k,n),o=new Float64Array(n).fill(NaN);
    for(let i=k-1;i<n;i++){const m=ma[i];if(isNaN(m))continue;let md=0;for(let j=i-k+1;j<=i;j++)md+=Math.abs(src[j]-m);md/=k;o[i]=md===0?0:(src[i]-m)/(0.015*md)}return o}},
});
const VS_DECL=["indicator","input","plot","hline","input_bool","input_source","plotshape","bgcolor"];
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
  const out={name:"",overlay:true,plots:[],hlines:[],inputs:[],bgcolors:[]};let nodes=0;const iv=inputVals||{};
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
    if(f==="input_bool"||f==="input.bool"){const d=x.args.length?(ev(x.args[0])?1:0):1;const t=x.args[1]?str(x.args[1],"Title"):"Option "+(out.inputs.length+1);let v=iv[t]!=null?(iv[t]?1:0):d;out.inputs.push({title:t,type:"bool",def:d,v});return v}
    if(f==="input_source"||f==="input.source"){const d=x.args.length?ev(x.args[0]):E.close;return vsSer(d,n)}
    if(f==="plot"){if(out.plots.length>=VS_LIM.plots)throw vsErr(x,"Too many plots ("+VS_LIM.plots+" max)");if(!x.args.length)throw vsErr(x,"plot() needs a series","e.g. plot(ema(close, 20), \"EMA\")");
      const v=vsSer(ev(x.args[0]),n),title=x.args[1]?str(x.args[1],"The plot title"):"Plot "+(out.plots.length+1);
      const color=vsColor(x.kw.color?ev(x.kw.color):x.args[2]?ev(x.args[2]):["#2962ff","#fb923c","#9c27b0","#089981","#f23645"][out.plots.length%5],x);
      const width=x.kw.width?Math.max(1,Math.min(4,Math.round(scal(x.kw.width,"width")))):2,style=x.kw.style?str(x.kw.style,"style"):"line";
      if(!["line","histogram","area"].includes(style))throw vsErr(x,"Unknown plot style \u201c"+style+"\u201d","Use \"line\", \"histogram\" or \"area\".");
      for(const k in x.kw)if(!["color","width","style"].includes(k))throw vsErr(x,"plot() has no option \u201c"+k+"\u201d","Options: color, width, style.");
      out.plots.push({title,color,width,style,v});return 0}
    if(f==="plotshape"){const cond=vsSer(ev(x.args[0]),n);const title=x.args[1]?str(x.args[1],"Title"):"Shape "+(out.plots.length+1);const color=vsColor(x.kw.color?ev(x.kw.color):"blue",x);out.plots.push({title,color,width:2,style:"histogram",v:cond});return 0}
    if(f==="bgcolor"){const col=vsColor(ev(x.args[0]),x);out.bgcolors=out.bgcolors||[];out.bgcolors.push({color:col,cond:x.args[1]?vsSer(ev(x.args[1]),n):null});return 0}
    if(f==="hline"){if(out.hlines.length>=VS_LIM.hlines)throw vsErr(x,"Too many hlines ("+VS_LIM.hlines+" max)");const v=scal(x.args[0]||{k:"num",v:NaN,line:x.line,col:x.col},"hline() value");
      out.hlines.push({v,title:x.args[1]?str(x.args[1],"The line title"):"",color:vsColor(x.kw.color?ev(x.kw.color):"gray",x)});return 0}
    const F=vsOwn(VS_FN,f)?VS_FN[f]:null;if(!F){const sg=vsSuggest(f,[...Object.keys(VS_FN),...VS_DECL]);throw vsErr(x,"Unknown function \u201c"+f+"()\u201d",sg?"Did you mean \u201c"+sg+"()\u201d?":"See the function list in the help panel.")}
    const want=Array.isArray(F.a)?F.a:[F.a,F.a];for(const k in x.kw)throw vsErr(x,f+"() doesn\u2019t take named options","Write it as "+F.sig+".");
    if(x.args.length<want[0]||x.args.length>want[1])throw vsErr(x,f+"() takes "+(want[0]===want[1]?want[0]:want[0]+" or "+want[1])+" value"+(want[1]===1?"":"s")+", got "+x.args.length,"Write it as "+F.sig+".");
    const A=x.args.map(a=>{const v=ev(a);if(typeof v==="string")throw vsErr(a,f+"() works on numbers and series, not text");return v});return F.f(A,n,x,E)}
  for(const st of prog){
    if(st.k==="set")V[st.n]=ev(st.e);
    else if(st.k==="destruct"){
      const r=ev(st.e);
      if(Array.isArray(r)){
        for(let i=0;i<st.names.length;i++)V[st.names[i]]=r[i]!=null?r[i]:new Float64Array(n);
      } else {
        if(st.names[0])V[st.names[0]]=r;
      }
    }
    else ev(st.e);
  }
  if(!out.plots.length&&!out.hlines.length)throw new VSError("Nothing to show: add a plot(...) line",0,0,"e.g. plot(ema(close, 20), \"EMA 20\")");
  return out}

function vsTranspilePine(src) {
  if (typeof src !== "string") return "";
  let s = src.replace(/\r\n/g, "\n");
  s = s.replace(/\/\/\s*@version\s*=\s*[0-9]+/gi, "// Pine Script auto-translated to Vektor Script");
  s = s.replace(/\b(?:var|varip)\s+(?:(?:series\s+)?(?:float|int|bool|color|string)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/g, "$1 =");
  s = s.replace(/\b(?:series\s+)?(?:float|int|bool|color|string)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g, "$1 =");
  s = s.replace(/\bta\.sma\b/g, "sma");
  s = s.replace(/\bta\.ema\b/g, "ema");
  s = s.replace(/\bta\.rsi\b/g, "rsi");
  s = s.replace(/\bta\.macd\b/g, "macd");
  s = s.replace(/\bta\.bb\b/g, "bb");
  s = s.replace(/\bta\.vwap\b/g, "vwap");
  s = s.replace(/\bta\.stoch\b/g, "stoch");
  s = s.replace(/\bta\.cci\b/g, "cci");
  s = s.replace(/\bta\.atr\b/g, "atr");
  s = s.replace(/\bta\.tr\b/g, "tr");
  s = s.replace(/\bta\.highest\b/g, "highest");
  s = s.replace(/\bta\.lowest\b/g, "lowest");
  s = s.replace(/\bta\.crossover\b/g, "crossover");
  s = s.replace(/\bta\.crossunder\b/g, "crossunder");
  s = s.replace(/\bta\.change\b/g, "change");
  s = s.replace(/\bta\.roc\b/g, "roc");
  s = s.replace(/\bta\.stdev\b/g, "stdev");
  s = s.replace(/\bta\.cum\b/g, "cum");
  s = s.replace(/\bta\.wma\b/g, "wma");
  s = s.replace(/\bta\.rma\b/g, "rma");
  s = s.replace(/\bmath\.abs\b/g, "abs");
  s = s.replace(/\bmath\.max\b/g, "max");
  s = s.replace(/\bmath\.min\b/g, "min");
  s = s.replace(/\bmath\.sqrt\b/g, "sqrt");
  s = s.replace(/\bmath\.round\b/g, "round");
  s = s.replace(/\bmath\.floor\b/g, "floor");
  s = s.replace(/\bmath\.ceil\b/g, "ceil");
  s = s.replace(/\bmath\.pow\b/g, "pow");
  s = s.replace(/\bmath\.log\b/g, "log");
  s = s.replace(/\bmath\.exp\b/g, "exp");
  s = s.replace(/\binput\.int\b/g, "input");
  s = s.replace(/\binput\.float\b/g, "input");
  s = s.replace(/\binput\.price\b/g, "input");
  s = s.replace(/\binput\.bool\b/g, "input_bool");
  s = s.replace(/\binput\.source\b/g, "input_source");
  s = s.replace(/\binput\.string\b/g, "input");
  s = s.replace(/\bcolor\.new\(([^,)]+)[^)]*\)/g, "$1");
  s = s.replace(/\bcolor\.([a-z]+)\b/gi, '"$1"');
  s = s.replace(/\bplot\.style_histogram\b/g, '"histogram"');
  s = s.replace(/\bplot\.style_area\b/g, '"area"');
  s = s.replace(/\bplot\.style_line\b/g, '"line"');
  s = s.replace(/\b(?:ta|math|color|input)\.([A-Za-z0-9_]+)/g, "$1");
  return s;
}
