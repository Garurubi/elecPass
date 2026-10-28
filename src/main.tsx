import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Dexie, { type Table } from 'dexie';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Download, History, Lightbulb, Play, RotateCcw, Shuffle, Star, Target, TrendingUp, Upload, Zap } from 'lucide-react';
import data from './questions.json';
import { accuracy, grade, shuffle } from './logic.mjs';
import './style.css';

type Question = typeof data.questions[number];
type RecordItem = { questionId: string; response: string; correct: boolean | null; time: string };
type Session = { ids: string[]; index: number; mode: 'study' | 'exam'; title: string; responses: Record<string, string>; revealed: string[]; results: Record<string, boolean | null>; finished: boolean };
type Saved = { version: 1; favorites: string[]; records: RecordItem[]; session: Session | null };
const empty: Saved = { version: 1, favorites: [], records: [], session: null };
const db = new Dexie('elecpass');
db.version(1).stores({ state: 'id' });
const table = db.table('state') as Table<{ id: string; value: Saved }>;
const qmap = new Map(data.questions.map(q => [q.id, q]));
const labels = { ox: 'OX 문제', short: '단답형', choice: '객관식' };
const symbols = ['①', '②', '③', '④'];
function validSaved(v: unknown): v is Saved {
  if (!v || typeof v !== 'object') return false;
  const x = v as Saved;
  if (x.version !== 1 || !Array.isArray(x.favorites) || !x.favorites.every(id => typeof id === 'string') || !Array.isArray(x.records)) return false;
  if (!x.records.every(r => r && typeof r.questionId === 'string' && typeof r.response === 'string' && (r.correct === null || typeof r.correct === 'boolean') && typeof r.time === 'string' && !isNaN(Date.parse(r.time)))) return false;
  const s=x.session;
  return s === null || !!(s && Array.isArray(s.ids) && s.ids.length && s.ids.every(id=>qmap.has(id)) && Number.isInteger(s.index) && s.index>=0 && s.index<s.ids.length && ['study','exam'].includes(s.mode) && typeof s.title==='string' && typeof s.finished==='boolean' && Array.isArray(s.revealed) && s.revealed.every(id=>s.ids.includes(id)) && s.responses && Object.values(s.responses).every(a=>typeof a==='string') && s.results && Object.values(s.results).every(a=>a===null||typeof a==='boolean'));
}
function App() {
  const [saved, setSaved] = useState<Saved>(empty);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState('home');
  const [setup, setSetup] = useState('');
  const [book, setBook] = useState('all');
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<'study' | 'exam'>('study');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const writeQueue = useRef(Promise.resolve());
  useEffect(() => { table.get('main').then(async row => { if (row) { const previous = row.value; if (previous?.session && Array.isArray(previous.session.ids) && previous.session.ids.some(id=>!qmap.has(id))) { await table.put({id:`archive-${Date.now()}`,value:previous}); row.value={...previous,session:null}; } if(validSaved(row.value)) setSaved(row.value); else setMessage('저장된 기록을 읽을 수 없습니다. 백업 파일을 확인해 주세요.'); } }).catch(()=>setMessage('브라우저 저장소를 사용할 수 없습니다. 기록을 내보내 주세요.')).finally(()=>setReady(true)); }, []);
  useEffect(() => { if (ready) writeQueue.current=writeQueue.current.then(async()=>{await table.put({id:'main',value:saved});}).catch(()=>{setMessage('기록 저장에 실패했습니다. 기록 내보내기로 백업해 주세요.');}); }, [saved, ready]);
  useEffect(()=>{window.scrollTo(0,0);},[page,saved.session?.index]);
  const favorite = (id:string) => setSaved(p=>({...p,favorites:p.favorites.includes(id)?p.favorites.filter(x=>x!==id):[...p.favorites,id]}));
  const latest = new Map<string,RecordItem>(); saved.records.forEach(r=>{if(r.correct!==null)latest.set(r.questionId,r);});
  const wrongIds=[...latest.values()].filter(r=>r.correct===false&&qmap.has(r.questionId)).map(r=>r.questionId);
  const rate=accuracy(saved.records);
  const pool=data.questions.filter(q=>{
    if (setup === '즐겨찾기') return saved.favorites.includes(q.id);
    if (setup === '오답 복습') return wrongIds.includes(q.id) && (book === 'all' || q.bookId === book);
    return book === 'all' || q.bookId === book;
  });
  function begin() {
    let list=pool;
    if(setup==='오답 복습')list=list.filter(q=>wrongIds.includes(q.id));
    if(setup==='즐겨찾기')list=list.filter(q=>saved.favorites.includes(q.id));
    if(setup==='랜덤 문제')list=shuffle(list).slice(0,count);
    if(!list.length){setMessage('선택한 조건에 해당하는 문제가 없습니다.');return;}
    setSaved(p=>({...p,session:{ids:list.map(q=>q.id),index:0,title:setup,mode,responses:{},revealed:[],results:{},finished:false}}));
    setSetup('');setPage('quiz');
  }
  function openSetup(title:string) {setSetup(title);setBook('all');setMode('study');}
  function submit(correct?:boolean) {
    setSaved(p=>{
      const s=p.session!; const id=s.ids[s.index], q=qmap.get(id)!;
      if(Object.hasOwn(s.results,id))return p;
      const response=s.responses[id]||'';
      const result=correct??grade(q,response);
      if(q.type==='short'&&q.answer&&correct===undefined)return {...p,session:{...s,revealed:[...new Set([...s.revealed,id])]}};
      return {...p,records:[...p.records,{questionId:id,response,correct:result,time:new Date().toISOString()}],session:{...s,revealed:[...new Set([...s.revealed,id])],results:{...s.results,[id]:result}}};
    });
  }
  function finishExam() {
    setSaved(p=>{const s=p.session!;const results={...s.results}; const records=[...p.records];
      s.ids.forEach(id=>{if(!Object.hasOwn(results,id)){const q=qmap.get(id)!; const response=s.responses[id]||'';const correct=grade(q,response);results[id]=correct;records.push({questionId:id,response,correct,time:new Date().toISOString()});}});
      return {...p,records,session:{...s,results,finished:true}};});
    setPage('result');
  }
  function exportData(){const url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`elecpass-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}
  async function importData(file?:File){if(!file)return;try{if(file.size>10_000_000)throw Error();const v=JSON.parse(await file.text());if(!validSaved(v))throw Error();if(!window.confirm('현재 학습 기록을 백업 파일의 기록으로 교체할까요?'))return;setSaved(v);setPage('home');setMessage('학습 기록을 가져왔습니다.');}catch{setMessage('올바른 전기패스 백업 파일이 아닙니다.');}finally{if(fileInput.current)fileInput.current.value='';}}
  const s=saved.session;
  const q=s?qmap.get(s.ids[s.index])!:null;
  const answered=!!(s&&q&&Object.hasOwn(s.results,q.id));
  const revealed=!!(s&&q&&s.revealed.includes(q.id));
  const displayAnswer=!!(s?.mode==='study'&&revealed);
  const sessionRecords=s?s.ids.map(id=>({correct:s.results[id]})):[];
  const daily=new Map<string,RecordItem[]>();saved.records.forEach(r=>{const day=new Date(r.time).toLocaleDateString('sv-SE');daily.set(day,[...(daily.get(day)||[]),r]);});
  if(!ready)return <main className="loading">학습 기록을 불러오고 있어요…</main>;
  return <><header className="topbar"><div className="topbar-inner"><button className="brand" onClick={()=>setPage('home')}><span className="brand-icon"><Zap size={21} fill="currentColor"/></span>전기패스<span className="brand-sub">ELEC PASS</span></button><span className="top-note">작은 반복이 만드는 합격</span><button className="icon-btn" title="학습 기록" aria-label="학습 기록" onClick={()=>setPage('stats')}><History size={21}/></button></div></header>
  <main>{message&&<div role="status" className="notice">{message}<button onClick={()=>setMessage('')}>닫기</button></div>}
  {page==='home'&&<><section className="intro"><div><div className="eyebrow">전기설비 학습 노트</div><h1>오늘도, 한 문제 더.</h1><p>차근차근 쌓아가는 나만의 합격 준비</p></div><span className="intro-symbol"><Zap size={38}/></span></section>
  <section className="overview"><div><span className="pill">과정평가형 · 전기설비</span><h2>개념은 확실하게,<br className="mobile-break"/> 복습은 꾸준하게.</h2><p>{data.books.length}개 문제집 <span>·</span> {data.questions.length}문항 <span>·</span> 정답 {data.questions.filter(q=>q.answer).length} / 해설 {data.questions.filter(q=>q.explanation).length}문항</p></div><div className="overview-side"><BookOpen size={30}/><span>오늘의 작은 진전</span><strong>{saved.records.filter(r=>new Date(r.time).toDateString()===new Date().toDateString()).length}<small> 문제 학습</small></strong></div></section>
  {s&&!s.finished&&<button className="resume" onClick={()=>setPage('quiz')}><Play size={18}/><span>이어서 풀기 <small>{s.title} · {s.index+1}/{s.ids.length}</small></span><ArrowRight size={19}/></button>}
  <div className="section-title"><h3>문제 풀기</h3><span>나에게 맞는 방식으로</span></div><div className="menu-grid">
  {[{name:'랜덤 문제',desc:'문제 수를 정해 새로운 조합으로 학습',icon:Shuffle,tone:'blue'},{name:'문제집별 풀이',desc:'문제집을 선택해 처음부터 차근차근',icon:BookOpen,tone:'purple'},{name:'오답 복습',desc:'틀렸던 문제를 다시 풀며 빈틈 채우기',icon:RotateCcw,tone:'orange'},{name:'즐겨찾기',desc:'별표한 문제만 모아서 집중 학습',icon:Star,tone:'yellow'}].map(item=><button className="menu-card" key={item.name} onClick={()=>openSetup(item.name)}><span className={`tile-icon ${item.tone}`}><item.icon size={23}/></span><div><h2>{item.name}</h2><p>{item.desc}</p></div><ChevronRight className="card-arrow" size={19}/></button>)}</div>
  <div className="section-title"><h3>나의 학습</h3><button onClick={()=>setPage('stats')}>전체 기록 <ArrowRight size={14}/></button></div><section className="metrics">{[['오답',wrongIds.length],['즐겨찾기',saved.favorites.filter(id=>qmap.has(id)).length],['누적 풀이',saved.records.length],['정답률',rate===null?'—':`${rate}%`]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
  <section className="library"><div className="section-title"><h3>내 문제집</h3><span>PDF에서 가져온 학습 자료</span></div>{data.books.map(b=><button className="book-row" key={b.id} onClick={()=>{openSetup('문제집별 풀이');setBook(b.id);}}><span className="book-icon"><BookOpen size={20}/></span><span><strong>{b.title}</strong><small>{b.note} · {b.count}문항</small></span><span className={`status ${b.hasAnswers?'available':''}`}>{b.hasAnswers?'학습 준비 완료':'문제만 수록'}</span><ChevronRight size={17}/></button>)}</section></>}
  {page==='quiz'&&s&&q&&<><div className="quiz-heading"><button className="back" onClick={()=>setPage('home')}><ArrowLeft size={17}/> 나가기</button><span>{s.mode==='study'?'해설 모드':'실전 모드'}</span></div><h1 className="quiz-title">{s.title}</h1><div className="progress-label"><span>{data.books.find(b=>b.id===q.bookId)?.title}</span><strong>{s.index+1} <span>/ {s.ids.length}</span></strong></div><progress value={s.index+1} max={s.ids.length}/><div className="question-meta"><span>{labels[q.type as keyof typeof labels]}</span><span>{q.topic}</span></div>
  <section className="question-card"><div className="question-top"><span className="eyebrow">QUESTION {String(q.number).padStart(2,'0')}</span><button className={`icon-btn star ${saved.favorites.includes(q.id)?'active':''}`} aria-label="즐겨찾기" aria-pressed={saved.favorites.includes(q.id)} onClick={()=>favorite(q.id)}><Star fill={saved.favorites.includes(q.id)?'currentColor':'none'}/></button></div><h2>{q.prompt}</h2>
  {q.type==='short'?<label className="answer-label">나의 답안<textarea placeholder="기억나는 답을 적어 보세요." value={s.responses[q.id]||''} disabled={revealed} onChange={e=>setSaved(p=>({...p,session:{...p.session!,responses:{...p.session!.responses,[q.id]:e.target.value}}}))}/></label>:<div className={`choices ${q.type==='ox'?'ox':''}`}>{(q.type==='ox'?['O','X']:q.options).map((option,i)=>{const val=q.type==='ox'?option:symbols[i];return <button key={i} disabled={revealed} aria-pressed={s.responses[q.id]===val} className={`choice ${s.responses[q.id]===val?'selected':''}`} onClick={()=>setSaved(p=>({...p,session:{...p.session!,responses:{...p.session!.responses,[q.id]:val}}}))}>{q.type==='choice'&&<span className="option-number">{i+1}</span>}{option}{s.responses[q.id]===val&&<Check size={18}/>}</button>;})}</div>}
  {!q.answer&&<p className="ungraded">{q.answerNote||'정답 미등록 문항입니다. 답안을 연습할 수 있으며 정답률에는 반영되지 않습니다.'}</p>}</section>
  {displayAnswer&&<section className="answer-card"><div className="eyebrow"><Lightbulb size={17}/> {q.answer?'정답 및 해설':'풀이 기록'} {answered&&s.results[q.id]!==null&&<span className={s.results[q.id]?'correct':'incorrect'}>{s.results[q.id]?'정답입니다':'다시 기억해 보세요'}</span>}</div><h2>{q.answer||(q.answerNote?'정답 확인 필요':'답안을 저장했습니다.')}</h2><p>{q.explanation||q.explanationNote}</p>{q.reference&&<small>PDF 수록 출처 · {q.reference}</small>}{q.type==='short'&&q.answer&&!answered&&<div className="self-grade"><p>정답과 비교해서 직접 평가해 주세요.</p><button onClick={()=>submit(false)}>틀렸어요</button><button className="primary" onClick={()=>submit(true)}>맞았어요</button></div>}</section>}
  <div className="quiz-actions"><button className="secondary" disabled={s.index===0} onClick={()=>setSaved(p=>({...p,session:{...p.session!,index:p.session!.index-1}}))}><ArrowLeft size={17}/> 이전</button>{s.mode==='study'&&!revealed?<button className="primary" onClick={()=>submit()}>{q.answer?'정답 확인':'풀이 기록하기'} <Check size={17}/></button>:<button className="primary" disabled={s.mode==='study'&&!answered} onClick={()=>{if(s.index===s.ids.length-1){if(s.mode==='exam')finishExam();else{setSaved(p=>({...p,session:{...p.session!,finished:true}}));setPage('result');}}else setSaved(p=>({...p,session:{...p.session!,index:p.session!.index+1}}));}}>{s.index===s.ids.length-1?'학습 마치기':'다음 문제'}<ArrowRight size={17}/></button>}</div>{s.mode==='exam'&&<p className="helper">정답은 학습을 마친 뒤 공개됩니다. 미응답 객관식·OX는 오답 처리됩니다.</p>}</>}
  {page==='result'&&s&&<><button className="back" onClick={()=>setPage('home')}><ArrowLeft size={17}/> 홈으로</button><section className="result-hero"><span className="tile-icon blue"><Target size={30}/></span><div className="eyebrow">한 걸음 더 가까워졌어요</div><h1>오늘의 학습 완료!</h1><p>{s.ids.length}문항을 학습했습니다.</p><strong>{accuracy(sessionRecords)===null?'채점 없음':`${accuracy(sessionRecords)}%`}</strong><p>OX·객관식 자동 채점 / 단답형 직접 평가</p></section><div className="review-list">{s.ids.map(id=>{const item=qmap.get(id)!;return <details key={id}><summary><span className={`result-dot ${s.results[id]===true?'good':s.results[id]===false?'bad':''}`}>{s.results[id]===true?'✓':s.results[id]===false?'×':'–'}</span><span>{item.prompt}</span><ChevronRight size={17}/></summary><div className="review-body"><p>나의 답: {s.responses[id]||'미입력'}</p><h3>정답: {item.answer||'미등록'}</h3>{item.answerNote&&<p className="ungraded">{item.answerNote}</p>}<p>{item.explanation||item.explanationNote}</p>{item.type==='short'&&item.answer&&s.results[id]===null&&<div className="self-grade"><p>단답형 답안을 직접 평가하세요.</p>{[false,true].map(correct=><button key={String(correct)} onClick={()=>setSaved(p=>{const records=[...p.records];let index=-1;for(let j=records.length-1;j>=0;j--)if(records[j].questionId===id){index=j;break;}if(index>=0)records[index]={...records[index],correct};return {...p,records,session:{...p.session!,results:{...p.session!.results,[id]:correct}}};})}>{correct?'맞았어요':'틀렸어요'}</button>)}</div>}<button className="text-btn" onClick={()=>favorite(id)}>{saved.favorites.includes(id)?'★ 즐겨찾기 해제':'☆ 즐겨찾기 추가'}</button></div></details>;})}</div><button className="primary full" onClick={()=>setPage('home')}>홈으로 돌아가기</button></>}
  {page==='stats'&&<><button className="back" onClick={()=>setPage('home')}><ArrowLeft size={17}/> 홈으로</button><div className="intro"><div className="eyebrow">MY LEARNING</div><h1>쌓여가는 나의 기록</h1><p>자동 채점과 직접 평가한 결과를 함께 확인하세요.</p></div><section className="metrics">{[['누적 풀이',saved.records.length],['정답률',rate===null?'—':`${rate}%`],['남은 오답',wrongIds.length],['학습 일수',daily.size]].map(([l,v])=><div key={l}><span>{l}</span><strong>{v}</strong></div>)}</section><div className="section-title"><h3>일별 학습</h3><TrendingUp size={18}/></div>{daily.size===0?<div className="empty"><BookOpen size={32}/><h2>첫 학습을 시작해 보세요.</h2><p>문제를 풀면 이곳에 기록이 쌓입니다.</p><button className="primary" onClick={()=>openSetup('랜덤 문제')}>문제 풀기</button></div>:<section className="daily-list">{[...daily.entries()].reverse().map(([date,records])=><div className="daily-row" key={date}><span>{date}</span><div className="bar-track"><div style={{width:`${Math.max(4,records.length/Math.max(...[...daily.values()].map(a=>a.length))*100)}%`}}/></div><strong>{records.length}문제</strong><small>{accuracy(records)===null?'미채점':`${accuracy(records)}%`}</small></div>)}</section>}<section className="backup"><h3>기록 백업</h3><p>학습 기록은 이 브라우저에 저장됩니다. 다른 기기로 옮기거나 브라우저 데이터를 삭제하기 전에 백업해 주세요.</p><button className="secondary" onClick={exportData}><Download size={17}/> 기록 내보내기</button><button className="secondary" onClick={()=>fileInput.current?.click()}><Upload size={17}/> 기록 가져오기</button></section></>}
  <footer><span><Zap size={13}/> 전기패스</span><span>나의 속도로, 꾸준하게.</span><button onClick={()=>setPage('stats')}>기록 관리</button></footer></main>
  <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e=>importData(e.target.files?.[0])}/>
  {setup&&<div className="modal-backdrop" onClick={()=>setSetup('')}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setSetup('');if(e.key==='Tab'){const els=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,select,input')).filter(el=>!(el as HTMLButtonElement).disabled);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><div className="modal-title"><h2 id="setup-title">{setup}</h2><button autoFocus className="icon-btn" aria-label="닫기" onClick={()=>setSetup('')}>×</button></div><p>오늘의 학습 범위를 선택하세요.</p>{setup!=='즐겨찾기'&&<label>문제집<select value={book} onChange={e=>setBook(e.target.value)}><option value="all">전체 문제집</option>{data.books.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label>}<label>풀이 방식<select value={mode} onChange={e=>setMode(e.target.value as 'study'|'exam')}><option value="study">해설 모드 · 한 문제씩 정답 확인</option><option value="exam">실전 모드 · 모두 푼 뒤 정답 확인</option></select></label>{setup==='랜덤 문제'&&<label>문제 수<input type="number" min={1} max={data.questions.length} value={count} onChange={e=>setCount(Math.max(1,Math.min(data.questions.length,Number(e.target.value)||1)))}/></label>}
  <p className="helper">선택 가능한 문제 {pool.filter(q=>setup==='오답 복습'?wrongIds.includes(q.id):setup==='즐겨찾기'?saved.favorites.includes(q.id):true).length}개{s&&!s.finished&&' · 시작하면 진행 중인 풀이를 교체합니다.'}</p>
  <button className="primary full" onClick={begin}>학습 시작 <ArrowRight size={18}/></button></section></div>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
